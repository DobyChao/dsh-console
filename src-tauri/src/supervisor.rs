use std::collections::{HashMap, VecDeque};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::{homes_equal, Instance, LauncherConfig};
use crate::process::{empty_slot, pipe_lines, ChildSlot, Spawned, StopTarget};

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
    child: ChildSlot,
}

impl Running {
    fn starting(id: String) -> Self {
        Self {
            pid: 0,
            runtime: RuntimeInfo {
                id,
                status: ProcStatus::Starting,
                url: None,
                error: None,
                pid: None,
                needs_restart: false,
            },
            logs: VecDeque::new(),
            child: empty_slot(),
        }
    }
}

pub enum StartGate {
    AlreadyRunning,
    Stopping,
    Ready,
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

    pub fn clear_logs(&mut self, id: &str) {
        if let Some(r) = self.running.get_mut(id) {
            r.logs.clear();
        }
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

pub fn start_gate(sup: &Supervisor, id: &str) -> StartGate {
    match sup.running.get(id).map(|r| r.runtime.status) {
        Some(ProcStatus::Starting | ProcStatus::Ready) => StartGate::AlreadyRunning,
        Some(ProcStatus::Stopping) => StartGate::Stopping,
        _ => StartGate::Ready,
    }
}

/// Short critical section: preflight + mark Starting. Caller must spawn **outside** the lock.
pub fn begin_start(
    app: &AppHandle,
    sup: &mut Supervisor,
    cfg: &LauncherConfig,
    inst: &Instance,
) -> Result<(), String> {
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

    if let Some(old) = sup.running.remove(&inst.id) {
        if let Ok(mut slot) = old.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.start_kill();
            }
        }
    }

    let mut running = Running::starting(inst.id.clone());
    push_log(
        app,
        &mut running,
        format!(
            "启动 profile={}  port={}  home={}",
            inst.profile, inst.port, inst.dsh_home
        ),
    );
    sup.running.insert(inst.id.clone(), running);
    emit_runtimes(app, sup, &cfg.instances);
    Ok(())
}

pub fn fail_start(app: &AppHandle, sup: &mut Supervisor, instances: &[Instance], id: &str, err: String) {
    if let Some(running) = sup.running.get_mut(id) {
        if running.runtime.status != ProcStatus::Starting {
            return;
        }
        running.runtime.status = ProcStatus::Error;
        running.runtime.error = Some(err.clone());
        running.runtime.pid = None;
        push_log(app, running, format!("启动失败：{err}"));
    }
    crate::tray::refresh_tray(app, sup, instances);
    emit_runtimes(app, sup, instances);
}

/// Attach the spawned tree. If the user already clicked stop (or removed the instance),
/// return the child so the caller can kill it **after** dropping AppState.
pub fn attach_spawned(
    app: &AppHandle,
    sup: &mut Supervisor,
    instances: &[Instance],
    id: &str,
    mut spawned: Spawned,
) -> Option<StopTarget> {
    let pid = spawned.child.id();
    let stdout = spawned.child.stdout().take();
    let stderr = spawned.child.stderr().take();

    let Some(running) = sup.running.get_mut(id) else {
        pipe_lines(stdout, |_| {});
        pipe_lines(stderr, |_| {});
        return Some(StopTarget {
            pid,
            child: Some(spawned.child),
        });
    };
    if running.runtime.status == ProcStatus::Stopping {
        pipe_lines(stdout, |_| {});
        pipe_lines(stderr, |_| {});
        return Some(StopTarget {
            pid,
            child: Some(spawned.child),
        });
    }

    running.pid = pid;
    running.runtime.pid = Some(pid);
    push_log(app, running, format!("已启动 pid={pid}"));

    let app_out = app.clone();
    let id_out = id.to_string();
    pipe_lines(stdout, move |line| {
        handle_line(&app_out, &id_out, line, false);
    });
    let app_err = app.clone();
    let id_err = id.to_string();
    pipe_lines(stderr, move |line| {
        handle_line(&app_err, &id_err, line, true);
    });

    let slot = running.child.clone();
    {
        let mut g = slot.lock().expect("child slot");
        *g = Some(spawned.child);
    }
    let (tx, rx) = mpsc::channel::<i32>();
    crate::process::watch_child_exit(slot, tx);
    let app_wait = app.clone();
    let id_wait = id.to_string();
    thread::spawn(move || {
        if let Ok(code) = rx.recv() {
            on_exit(&app_wait, &id_wait, code);
        }
    });

    emit_runtimes(app, sup, instances);
    None
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
        running.runtime.pid = None;
        running.runtime.url = None;
        running.runtime.needs_restart = false;
        if running.runtime.status == ProcStatus::Idle {
            // stop 已经收尾过，避免 wait() 晚到时把 Idle 改成 Error
            crate::tray::refresh_tray(app, &g.supervisor, &instances);
            emit_runtimes(app, &g.supervisor, &instances);
            return;
        }
        let stopping = running.runtime.status == ProcStatus::Stopping;
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
    }
    crate::tray::refresh_tray(app, &g.supervisor, &instances);
    emit_runtimes(app, &g.supervisor, &instances);
}

/// Mark stopping and take the child **after** dropping AppState.
pub fn begin_stop(app: &AppHandle, sup: &mut Supervisor, instances: &[Instance], id: &str) -> Option<StopTarget> {
    let running = sup.running.get_mut(id)?;
    if !matches!(
        running.runtime.status,
        ProcStatus::Starting | ProcStatus::Ready
    ) {
        return None;
    }
    running.runtime.status = ProcStatus::Stopping;
    let pid = running.pid;
    let child = running.child.lock().ok().and_then(|mut g| g.take());
    if pid == 0 && child.is_none() {
        // spawn 还没回来；attach_spawned 看到 Stopping 会把子进程交回来杀
        push_log(app, running, "正在停止（等待进程句柄）…".into());
        emit_runtimes(app, sup, instances);
        crate::tray::refresh_tray(app, sup, instances);
        return None;
    }
    push_log(app, running, format!("正在停止 pid={pid} …"));
    emit_runtimes(app, sup, instances);
    crate::tray::refresh_tray(app, sup, instances);
    Some(StopTarget { pid, child })
}

pub fn begin_stop_all(app: &AppHandle, sup: &mut Supervisor, instances: &[Instance]) -> Vec<StopTarget> {
    let ids: Vec<String> = sup.running.keys().cloned().collect();
    let mut targets = Vec::new();
    for id in ids {
        if let Some(target) = begin_stop(app, sup, instances, &id) {
            targets.push(target);
        }
    }
    targets
}

/// 杀进程返回后若 wait() 仍未把状态从 Stopping 清掉，由这里收尾，避免 UI 卡在「停止中」。
pub fn finalize_stop(app: &AppHandle, id: &str, reaped: bool) {
    let state = app.state::<crate::AppState>();
    let mut g = state.lock();
    let instances = g.config.instances.clone();
    let mut changed = false;
    if let Some(running) = g.supervisor.running.get_mut(id) {
        if running.runtime.status == ProcStatus::Stopping {
            running.runtime.pid = None;
            running.runtime.url = None;
            running.runtime.needs_restart = false;
            if reaped {
                running.runtime.status = ProcStatus::Idle;
                running.runtime.error = None;
                push_log(app, running, "已停止".into());
            } else {
                running.runtime.status = ProcStatus::Error;
                running.runtime.error = Some("未能结束进程。若端口仍被占用，请结束残留的 node/dsh 后重试。".into());
                push_log(app, running, "停止失败：进程仍在运行".into());
            }
            changed = true;
        }
    }
    if changed {
        crate::tray::refresh_tray(app, &g.supervisor, &instances);
        emit_runtimes(app, &g.supervisor, &instances);
    }
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
