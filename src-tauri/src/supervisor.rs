use std::collections::{HashMap, VecDeque};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::{homes_equal, Instance, LauncherConfig};
use crate::process::{pipe_lines, spawn_dsh};

const LOG_LIMIT: usize = 1800;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProcStatus {
    Idle,
    Starting,
    Ready,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub id: String,
    pub status: ProcStatus,
    pub url: Option<String>,
    pub error: Option<String>,
    pub pid: Option<u32>,
    pub needs_restart: bool,
}

impl RuntimeInfo {
    pub fn idle(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            status: ProcStatus::Idle,
            url: None,
            error: None,
            pid: None,
            needs_restart: false,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub id: String,
    pub line: String,
}

pub struct Running {
    pub pid: u32,
    pub runtime: RuntimeInfo,
    pub logs: VecDeque<String>,
}

impl Running {
    fn new(id: String, pid: u32) -> Self {
        Self {
            pid,
            runtime: RuntimeInfo {
                id,
                status: ProcStatus::Starting,
                url: None,
                error: None,
                pid: Some(pid),
                needs_restart: false,
            },
            logs: VecDeque::new(),
        }
    }
}

pub struct Supervisor {
    pub running: HashMap<String, Running>,
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            running: HashMap::new(),
        }
    }

    pub fn snapshot(&self, instances: &[Instance]) -> HashMap<String, RuntimeInfo> {
        let mut out = HashMap::new();
        for inst in instances {
            if let Some(r) = self.running.get(&inst.id) {
                out.insert(inst.id.clone(), r.runtime.clone());
            } else {
                out.insert(inst.id.clone(), RuntimeInfo::idle(&inst.id));
            }
        }
        out
    }

    pub fn logs(&self, id: &str) -> Vec<String> {
        self.running
            .get(id)
            .map(|r| r.logs.iter().cloned().collect())
            .unwrap_or_default()
    }
}

pub fn port_in_use_by_us(sup: &Supervisor, instances: &[Instance], port: u16, except_id: &str) -> bool {
    for inst in instances {
        if inst.id == except_id || inst.port != port {
            continue;
        }
        if let Some(r) = sup.running.get(&inst.id) {
            if matches!(
                r.runtime.status,
                ProcStatus::Starting | ProcStatus::Ready | ProcStatus::Stopping
            ) {
                return true;
            }
        }
    }
    false
}

pub fn bind_available(port: u16) -> Result<(), String> {
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => {
            drop(listener);
            Ok(())
        }
        Err(_) => Err(format!(
            "端口 {port} 已被占用。第二实例请改端口（建议 3081）。"
        )),
    }
}

pub fn home_locked(sup: &Supervisor, instances: &[Instance], home: &str, except_id: &str) -> Option<String> {
    for inst in instances {
        if inst.id == except_id {
            continue;
        }
        if !homes_equal(&inst.dsh_home, home) {
            continue;
        }
        if let Some(r) = sup.running.get(&inst.id) {
            if matches!(
                r.runtime.status,
                ProcStatus::Starting | ProcStatus::Ready | ProcStatus::Stopping
            ) {
                return Some(inst.display_name.clone());
            }
        }
    }
    None
}

pub fn start(
    app: &AppHandle,
    sup: &mut Supervisor,
    cfg: &LauncherConfig,
    inst: &Instance,
) -> Result<(), String> {
    if let Some(r) = sup.running.get(&inst.id) {
        if matches!(
            r.runtime.status,
            ProcStatus::Starting | ProcStatus::Ready | ProcStatus::Stopping
        ) {
            return Err("该实例已在运行".into());
        }
    }
    if let Some(name) = home_locked(sup, &cfg.instances, &inst.dsh_home, &inst.id) {
        return Err(format!("同一 DSH_HOME 已被实例「{name}」占用"));
    }
    if port_in_use_by_us(sup, &cfg.instances, inst.port, &inst.id) {
        return Err(format!(
            "端口 {} 已被本启动器其它实例占用。第二实例请改端口（建议 3081）。",
            inst.port
        ));
    }
    bind_available(inst.port)?;

    let extra = vec![
        "--profile".to_string(),
        inst.profile.clone(),
        "--port".to_string(),
        inst.port.to_string(),
    ];
    let extra_ref: Vec<&str> = extra.iter().map(|s| s.as_str()).collect();
    let mut child = spawn_dsh(cfg, &extra_ref, &inst.dsh_home, inst.cwd.as_deref(), true)?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = mpsc::channel::<i32>();
    crate::process::wait_child_exit(child, tx);

    let mut running = Running::new(inst.id.clone(), pid);
    push_log(
        app,
        &mut running,
        format!("启动 pid={pid}  profile={}  port={}  home={}", inst.profile, inst.port, inst.dsh_home),
    );
    sup.running.insert(inst.id.clone(), running);
    emit_runtimes(app, sup, &cfg.instances);

    let app_out = app.clone();
    let id_out = inst.id.clone();
    pipe_lines(stdout, move |line| {
        handle_line(&app_out, &id_out, line, false);
    });
    let app_err = app.clone();
    let id_err = inst.id.clone();
    pipe_lines(stderr, move |line| {
        handle_line(&app_err, &id_err, line, true);
    });

    let app_wait = app.clone();
    let id_wait = inst.id.clone();
    thread::spawn(move || {
        let code = rx.recv().unwrap_or(1);
        on_exit(&app_wait, &id_wait, code);
    });

    Ok(())
}

fn handle_line(app: &AppHandle, id: &str, line: String, is_err: bool) {
    let state = app.state::<crate::AppState>();
    let mut g = state.lock();
    let mut became_ready = false;
    {
        let Some(running) = g.supervisor.running.get_mut(id) else {
            return;
        };
        if running.runtime.status == ProcStatus::Stopping {
            push_log(app, running, line);
            return;
        }
        if let Some(url) = parse_ready_url(&line) {
            running.runtime.status = ProcStatus::Ready;
            running.runtime.url = Some(url);
            running.runtime.error = None;
            became_ready = true;
        }
        if is_err && line.contains("allowBuilds") {
            push_log(
                app,
                running,
                "提示：把 pnpm 打印的键写进该 profile 的 pnpm-workspace.yaml / package.json 的 pnpm.allowBuilds，然后重试。".into(),
            );
        }
        push_log(app, running, line);
    }
    let instances = g.config.instances.clone();
    if became_ready {
        crate::tray::refresh_tray(app, &g.supervisor, &instances);
    }
    emit_runtimes(app, &g.supervisor, &instances);
}

fn on_exit(app: &AppHandle, id: &str, code: i32) {
    let state = app.state::<crate::AppState>();
    let mut g = state.lock();
    let instances = g.config.instances.clone();
    if let Some(running) = g.supervisor.running.get_mut(id) {
        let stopping = running.runtime.status == ProcStatus::Stopping;
        running.runtime.pid = None;
        running.runtime.url = None;
        if stopping {
            running.runtime.status = ProcStatus::Idle;
            running.runtime.error = None;
            push_log(app, running, "已停止".into());
        } else if running.runtime.status != ProcStatus::Ready {
            running.runtime.status = ProcStatus::Error;
            running.runtime.error = Some(format!("进程退出，代码 {code}"));
            push_log(app, running, format!("进程退出，代码 {code}"));
        } else {
            running.runtime.status = if code == 0 {
                ProcStatus::Idle
            } else {
                ProcStatus::Error
            };
            if code != 0 {
                running.runtime.error = Some(format!("进程退出，代码 {code}"));
            }
            push_log(app, running, format!("进程退出，代码 {code}"));
        }
        running.runtime.needs_restart = false;
    }
    crate::tray::refresh_tray(app, &g.supervisor, &instances);
    emit_runtimes(app, &g.supervisor, &instances);
}

/// Mark stopping and return the pid to kill **after** dropping AppState.
pub fn begin_stop(app: &AppHandle, sup: &mut Supervisor, instances: &[Instance], id: &str) -> Option<u32> {
    let running = sup.running.get_mut(id)?;
    if running.runtime.pid.is_none() {
        running.runtime.status = ProcStatus::Idle;
        return None;
    }
    running.runtime.status = ProcStatus::Stopping;
    let pid = running.pid;
    push_log(app, running, format!("正在停止 pid={pid} …"));
    emit_runtimes(app, sup, instances);
    crate::tray::refresh_tray(app, sup, instances);
    Some(pid)
}

pub fn begin_stop_all(app: &AppHandle, sup: &mut Supervisor, instances: &[Instance]) -> Vec<u32> {
    let ids: Vec<String> = sup.running.keys().cloned().collect();
    let mut pids = Vec::new();
    for id in ids {
        if let Some(pid) = begin_stop(app, sup, instances, &id) {
            pids.push(pid);
        }
    }
    pids
}

pub fn mark_needs_restart(sup: &mut Supervisor, id: &str) {
    if let Some(r) = sup.running.get_mut(id) {
        if matches!(r.runtime.status, ProcStatus::Ready | ProcStatus::Starting) {
            r.runtime.needs_restart = true;
        }
    }
}

pub fn parse_ready_url(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix("dsh web:")?;
    let token = rest.split_whitespace().next()?;
    if token.starts_with("http://") || token.starts_with("https://") {
        Some(token.trim_end_matches([',', ';', ')']).to_string())
    } else {
        None
    }
}

fn push_log(app: &AppHandle, running: &mut Running, line: String) {
    if running.logs.len() >= LOG_LIMIT {
        running.logs.pop_front();
    }
    running.logs.push_back(line.clone());
    let _ = app.emit(
        "instance-log",
        LogEvent {
            id: running.runtime.id.clone(),
            line: line.clone(),
        },
    );
    crate::bridge_events::emit(
        "instance-log",
        &LogEvent {
            id: running.runtime.id.clone(),
            line,
        },
    );
}

pub fn emit_runtimes(app: &AppHandle, sup: &Supervisor, instances: &[Instance]) {
    let snap = sup.snapshot(instances);
    let _ = app.emit("runtimes-changed", &snap);
    crate::bridge_events::emit("runtimes-changed", &snap);
}

// Re-export Manager::state usage
use tauri::Manager;
