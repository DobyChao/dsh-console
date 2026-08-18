mod bridge_events;
mod catalog;
mod config;
mod envcheck;
mod http_bridge;
mod process;
mod profiles;
mod pnpm_builds;
mod supervisor;
mod tray;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use config::{Instance, LauncherConfig};
use supervisor::{ProcStatus, RuntimeInfo, Supervisor};

pub struct AppStateInner {
    pub config: LauncherConfig,
    pub supervisor: Supervisor,
}

pub struct AppState {
    inner: Mutex<AppStateInner>,
    probe_cache: Mutex<Option<envcheck::ToolProbe>>,
    pub http: reqwest::Client,
    pub config_dir: PathBuf,
}

impl AppState {
    pub fn lock(&self) -> MutexGuard<'_, AppStateInner> {
        self.inner.lock().expect("state poisoned")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherState {
    config: LauncherConfig,
    runtimes: HashMap<String, RuntimeInfo>,
    logs: HashMap<String, Vec<String>>,
}

fn persist(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let g = state.lock();
    config::save(&state.config_dir, &g.config)
}

fn snapshot(app: &AppHandle) -> LauncherState {
    let state = app.state::<AppState>();
    let g = state.lock();
    snapshot_of(&g)
}

fn snapshot_of(g: &AppStateInner) -> LauncherState {
    let runtimes = g.supervisor.snapshot(&g.config.instances);
    let mut logs = HashMap::new();
    for inst in &g.config.instances {
        logs.insert(inst.id.clone(), g.supervisor.logs(&inst.id));
    }
    LauncherState {
        config: g.config.clone(),
        runtimes,
        logs,
    }
}

fn focused_instance(app: &AppHandle) -> Result<Instance, String> {
    let state = app.state::<AppState>();
    let g = state.lock();
    config::focused(&g.config)
        .cloned()
        .ok_or_else(|| "没有焦点实例".to_string())
}

fn instance_by_id(app: &AppHandle, id: &str) -> Result<Instance, String> {
    let state = app.state::<AppState>();
    let g = state.lock();
    g.config
        .instances
        .iter()
        .find(|i| i.id == id)
        .cloned()
        .ok_or_else(|| "找不到该实例".to_string())
}

#[tauri::command]
fn get_state(app: AppHandle) -> LauncherState {
    snapshot(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, patch: config::SettingsPatch) -> Result<LauncherState, String> {
        let invalidate_tools = {
            let state = app.state::<AppState>();
            let mut g = state.lock();
            let before = (g.config.dsh_mode.clone(), g.config.dsh_path.clone(), g.config.checkout_path.clone());
            g.config.dsh_mode = patch.dsh_mode;
            g.config.dsh_path = patch.dsh_path.filter(|s| !s.trim().is_empty());
            g.config.checkout_path = patch.checkout_path.filter(|s| !s.trim().is_empty());
            g.config.appearance = patch.appearance;
            config::sanitize(&mut g.config);
            before != (g.config.dsh_mode.clone(), g.config.dsh_path.clone(), g.config.checkout_path.clone())
        };
        persist(&app)?;
        if invalidate_tools {
            *app.state::<AppState>().probe_cache.lock().expect("probe cache") = None;
        }
        Ok(snapshot(&app))
}

#[tauri::command]
fn upsert_instance(app: AppHandle, patch: config::InstancePatch) -> Result<LauncherState, String> {
    {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        config::upsert(&mut g.config, patch)?;
        config::sanitize(&mut g.config);
    }
    persist(&app)?;
    Ok(snapshot(&app))
}

#[tauri::command]
fn remove_instance(app: AppHandle, id: String) -> Result<LauncherState, String> {
    let target = {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        let instances = g.config.instances.clone();
        let target = supervisor::begin_stop(&app, &mut g.supervisor, &instances, &id);
        config::remove(&mut g.config, &id)?;
        target
    };
    if let Some(target) = target {
        let reaped = process::kill_stop_target(target);
        supervisor::finalize_stop(&app, &id, reaped);
    }
    persist(&app)?;
    Ok(snapshot(&app))
}

#[tauri::command]
fn set_focused(app: AppHandle, id: String) -> Result<LauncherState, String> {
    {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        if !g.config.instances.iter().any(|i| i.id == id) {
            return Err("找不到该实例".into());
        }
        g.config.focused_id = id;
    }
    persist(&app)?;
    Ok(snapshot(&app))
}

#[tauri::command]
fn probe_env(app: AppHandle, force: Option<bool>) -> envcheck::EnvProbe {
    let force = force.unwrap_or(true);
    let state = app.state::<AppState>();
    let cfg = { state.lock().config.clone() };
    let cached = if force {
        None
    } else {
        state.probe_cache.lock().expect("probe cache").clone()
    };
    let tools = match cached {
        Some(t) => t,
        None => {
            let t = envcheck::probe_tools(&cfg);
            *state.probe_cache.lock().expect("probe cache") = Some(t.clone());
            t
        }
    };
    envcheck::assemble(&cfg, &tools)
}

#[tauri::command]
fn start_instance(app: AppHandle, id: String) -> Result<LauncherState, String> {
    let inst = instance_by_id(&app, &id)?;
    let cfg = {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        match supervisor::start_gate(&g.supervisor, &id) {
            supervisor::StartGate::AlreadyRunning => return Ok(snapshot_of(&g)),
            supervisor::StartGate::Stopping => return Err("正在停止，请稍后再启动".into()),
            supervisor::StartGate::Ready => {}
        }
        let cfg = g.config.clone();
        supervisor::begin_start(&app, &mut g.supervisor, &cfg, &inst)?;
        crate::tray::refresh_tray(&app, &g.supervisor, &cfg.instances);
        cfg
    };

    let port = inst.port.to_string();
    let extra = ["--profile", inst.profile.as_str(), "--port", port.as_str()];
    let spawned = match process::spawn_dsh(&cfg, &extra, &inst.dsh_home, inst.cwd.as_deref(), true) {
        Ok(s) => s,
        Err(e) => {
            let state = app.state::<AppState>();
            let mut g = state.lock();
            let instances = g.config.instances.clone();
            supervisor::fail_start(&app, &mut g.supervisor, &instances, &id, e.clone());
            crate::tray::refresh_tray(&app, &g.supervisor, &instances);
            return Err(e);
        }
    };

    let leftover = {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        let instances = g.config.instances.clone();
        let leftover = supervisor::attach_spawned(&app, &mut g.supervisor, &instances, &id, spawned);
        crate::tray::refresh_tray(&app, &g.supervisor, &instances);
        leftover
    };
    if let Some(target) = leftover {
        let reaped = process::kill_stop_target(target);
        supervisor::finalize_stop(&app, &id, reaped);
    }
    Ok(snapshot(&app))
}

#[tauri::command]
fn stop_instance(app: AppHandle, id: String) -> Result<LauncherState, String> {
    let target = {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        let instances = g.config.instances.clone();
        supervisor::begin_stop(&app, &mut g.supervisor, &instances, &id)
    };
    if let Some(target) = target {
        let app2 = app.clone();
        let id2 = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let reaped = process::kill_stop_target(target);
            supervisor::finalize_stop(&app2, &id2, reaped);
        });
    }
    Ok(snapshot(&app))
}

#[tauri::command]
async fn restart_instance(app: AppHandle, id: String) -> Result<LauncherState, String> {
    let target = {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        let instances = g.config.instances.clone();
        supervisor::begin_stop(&app, &mut g.supervisor, &instances, &id)
    };
    if let Some(target) = target {
        let app2 = app.clone();
        let id2 = id.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let reaped = process::kill_stop_target(target);
            supervisor::finalize_stop(&app2, &id2, reaped);
        })
        .await;
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(400))).await;
    }
    start_instance(app, id)
}

#[tauri::command]
fn open_instance_url(app: AppHandle, id: Option<String>, url: Option<String>) -> Result<(), String> {
    let target = if let Some(u) = url.filter(|s| !s.trim().is_empty()) {
        u
    } else {
        let id = match id {
            Some(i) => i,
            None => focused_instance(&app)?.id,
        };
        let state = app.state::<AppState>();
        let g = state.lock();
        g.supervisor
            .running
            .get(&id)
            .and_then(|r| r.runtime.url.clone())
            .ok_or_else(|| "还没有可打开的 Web UI 地址（等日志出现 dsh web: …）".to_string())?
    };
    open_http(&app, &target)
}

fn open_http(app: &AppHandle, url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("只允许打开 http(s) 地址".into());
    }
    app.opener()
        .open_url(trimmed, None::<&str>)
        .map_err(|e| format!("无法打开浏览器：{e}"))
}

#[tauri::command]
fn list_profiles(app: AppHandle, id: Option<String>) -> Result<Vec<profiles::ProfileInfo>, String> {
    let inst = match id {
        Some(i) => instance_by_id(&app, &i)?,
        None => focused_instance(&app)?,
    };
    Ok(profiles::list_profiles(&inst.dsh_home))
}

#[tauri::command]
fn create_profile(app: AppHandle, name: String, id: Option<String>) -> Result<Vec<profiles::ProfileInfo>, String> {
    let inst = match id {
        Some(i) => instance_by_id(&app, &i)?,
        None => focused_instance(&app)?,
    };
    let state = app.state::<AppState>();
    let cfg = { state.lock().config.clone() };
    profiles::create_profile(&cfg, &inst.dsh_home, name.trim(), inst.cwd.as_deref())?;
    Ok(profiles::list_profiles(&inst.dsh_home))
}

#[tauri::command]
fn dump_config(app: AppHandle, profile: Option<String>, id: Option<String>) -> Result<String, String> {
    let inst = match id {
        Some(i) => instance_by_id(&app, &i)?,
        None => focused_instance(&app)?,
    };
    let profile = profile.unwrap_or(inst.profile.clone());
    let state = app.state::<AppState>();
    let cfg = { state.lock().config.clone() };
    profiles::dump_config(&cfg, &inst.dsh_home, &profile, inst.cwd.as_deref())
}

#[tauri::command]
async fn run_plugin(app: AppHandle, args: Vec<String>, id: Option<String>) -> Result<String, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_plugin_inner(app2, args, id))
        .await
        .map_err(|e| format!("插件命令中断：{e}"))?
}

fn run_plugin_inner(app: AppHandle, args: Vec<String>, id: Option<String>) -> Result<String, String> {
    let inst = match id {
        Some(i) => instance_by_id(&app, &i)?,
        None => focused_instance(&app)?,
    };
    let mutating = matches!(args.first().map(String::as_str), Some("add" | "update" | "install" | "remove"));
    if mutating {
        let state = app.state::<AppState>();
        let g = state.lock();
        match g.supervisor.running.get(&inst.id).map(|r| r.runtime.status) {
            Some(ProcStatus::Starting) => {
                return Err("实例正在启动，请就绪后再装卸插件。".into());
            }
            Some(ProcStatus::Stopping) => {
                return Err("实例正在停止，请稍后再装卸插件。".into());
            }
            _ => {}
        }
    }
    let state = app.state::<AppState>();
    let cfg = { state.lock().config.clone() };
    let out = profiles::run_plugin(&cfg, &inst.dsh_home, &inst.profile, &args, inst.cwd.as_deref())?;
    {
        let mut g = state.lock();
        supervisor::mark_needs_restart(&mut g.supervisor, &inst.id);
        let instances = g.config.instances.clone();
        supervisor::emit_runtimes(&app, &g.supervisor, &instances);
    }
    Ok(out)
}

#[tauri::command]
async fn list_installed(app: AppHandle, id: Option<String>) -> Result<Vec<profiles::InstalledPlugin>, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || list_installed_inner(app2, id))
        .await
        .map_err(|e| format!("列出已装插件中断：{e}"))?
}

fn list_installed_inner(app: AppHandle, id: Option<String>) -> Result<Vec<profiles::InstalledPlugin>, String> {
    let inst = match id {
        Some(i) => instance_by_id(&app, &i)?,
        None => focused_instance(&app)?,
    };
    let state = app.state::<AppState>();
    let cfg = { state.lock().config.clone() };
    profiles::list_installed(&cfg, &inst.dsh_home, &inst.profile, inst.cwd.as_deref())
}

#[tauri::command]
fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(match picked {
        None => None,
        Some(p) => {
            let fallback = p.to_string();
            Some(match p.into_path() {
                Ok(path) => config::display_path(&path),
                Err(_) => fallback,
            })
        }
    })
}

#[tauri::command]
async fn fetch_curated(app: AppHandle) -> catalog::CatalogPayload {
    let state = app.state::<AppState>();
    catalog::fetch_curated(&state.http, &state.config_dir).await
}

#[tauri::command]
async fn fetch_discovery(app: AppHandle) -> catalog::CatalogPayload {
    let state = app.state::<AppState>();
    catalog::fetch_discovery(&state.http, &state.config_dir).await
}

#[tauri::command]
async fn fetch_readme(app: AppHandle, full_name: String, branch: Option<String>) -> Result<String, String> {
    let state = app.state::<AppState>();
    catalog::fetch_readme(&state.http, &full_name, branch.as_deref()).await
}

#[tauri::command]
fn next_instance_port(app: AppHandle) -> u16 {
    let state = app.state::<AppState>();
    let g = state.lock();
    config::next_port(&g.config.instances)
}

#[tauri::command]
fn clear_logs(app: AppHandle, id: String) -> LauncherState {
    {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        g.supervisor.clear_logs(&id);
    }
    snapshot(&app)
}

pub(crate) fn http_dispatch(app: AppHandle, cmd: &str, args: serde_json::Value) -> serde_json::Value {
    fn ok(data: impl serde::Serialize) -> serde_json::Value {
        serde_json::json!({ "ok": true, "data": data })
    }
    fn err(e: impl ToString) -> serde_json::Value {
        serde_json::json!({ "ok": false, "error": e.to_string() })
    }
    fn result<T: serde::Serialize>(r: Result<T, String>) -> serde_json::Value {
        match r {
            Ok(data) => ok(data),
            Err(e) => err(e),
        }
    }
    fn req_string(args: &serde_json::Value, key: &str) -> String {
        opt_string(args, key).unwrap_or_default()
    }
    fn opt_string(args: &serde_json::Value, key: &str) -> Option<String> {
        match args.get(key) {
            None | Some(serde_json::Value::Null) => None,
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(v) => Some(v.to_string().trim_matches('"').to_string()),
        }
    }
    match cmd {
        "get_state" => ok(get_state(app)),
        "save_settings" => match serde_json::from_value(args.get("patch").cloned().unwrap_or(serde_json::Value::Null)) {
            Ok(patch) => result(save_settings(app, patch)),
            Err(e) => err(e),
        },
        "upsert_instance" => match serde_json::from_value(args.get("patch").cloned().unwrap_or(serde_json::Value::Null)) {
            Ok(patch) => result(upsert_instance(app, patch)),
            Err(e) => err(e),
        },
        "remove_instance" => result(remove_instance(app, req_string(&args, "id"))),
        "set_focused" => result(set_focused(app, req_string(&args, "id"))),
        "probe_env" => ok(probe_env(app, args.get("force").and_then(|v| v.as_bool()))),
        "start_instance" => result(start_instance(app, req_string(&args, "id"))),
        "stop_instance" => result(stop_instance(app, req_string(&args, "id"))),
        "restart_instance" => {
            result(tauri::async_runtime::block_on(restart_instance(app, req_string(&args, "id"))))
        }
        "open_instance_url" => result(open_instance_url(app, opt_string(&args, "id"), opt_string(&args, "url"))),
        "list_profiles" => result(list_profiles(app, opt_string(&args, "id"))),
        "create_profile" => result(create_profile(app, req_string(&args, "name"), opt_string(&args, "id"))),
        "dump_config" => result(dump_config(app, opt_string(&args, "profile"), opt_string(&args, "id"))),
        "run_plugin" => {
            let plugin_args = args
                .get("args")
                .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok())
                .unwrap_or_default();
            result(run_plugin_inner(app, plugin_args, opt_string(&args, "id")))
        }
        "list_installed" => result(list_installed_inner(app, opt_string(&args, "id"))),
        "pick_folder" => result(pick_folder(app)),
        "fetch_curated" => ok(tauri::async_runtime::block_on(fetch_curated(app))),
        "fetch_discovery" => ok(tauri::async_runtime::block_on(fetch_discovery(app))),
        "fetch_readme" => result(tauri::async_runtime::block_on(fetch_readme(
            app,
            req_string(&args, "fullName"),
            opt_string(&args, "branch"),
        ))),
        "next_instance_port" => ok(next_instance_port(app)),
        "clear_logs" => ok(clear_logs(app, req_string(&args, "id"))),
        other => err(format!("未知命令：{other}")),
    }
}

pub(crate) fn tray_start_focused(app: &AppHandle) {
    let Ok(inst) = focused_instance(app) else {
        return;
    };
    let _ = start_instance(app.clone(), inst.id);
    tray::show_main(app);
}

pub(crate) fn tray_stop_focused(app: &AppHandle) {
    let Ok(inst) = focused_instance(app) else {
        return;
    };
    let _ = stop_instance(app.clone(), inst.id);
}

pub(crate) fn tray_open_focused(app: &AppHandle) {
    let _ = open_instance_url(app.clone(), None, None);
}

pub(crate) fn quit_app(app: &AppHandle) {
    let targets = {
        let state = app.state::<AppState>();
        let mut g = state.lock();
        let instances = g.config.instances.clone();
        supervisor::begin_stop_all(app, &mut g.supervisor, &instances)
    };
    let joins: Vec<_> = targets
        .into_iter()
        .map(|target| {
            std::thread::spawn(move || {
                process::kill_stop_target_timeout(target, Duration::from_secs(2))
            })
        })
        .collect();
    for join in joins {
        let _ = join.join();
    }
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_root = app.path().config_dir().map_err(|e| e.to_string())?;
            let legacy = app.path().app_config_dir().ok();
            let config_dir = config::resolve_dir(&config_root, legacy.as_deref())?;
            let config = config::load_or_default(&config_dir)?;
            let http = reqwest::Client::builder()
                .user_agent("dsh-console/0.1")
                .build()
                .map_err(|e| e.to_string())?;
            app.manage(AppState {
                inner: Mutex::new(AppStateInner {
                    config,
                    supervisor: Supervisor::new(),
                }),
                probe_cache: Mutex::new(None),
                http,
                config_dir,
            });
            tray::setup_tray(&app.handle())?;
            http_bridge::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_settings,
            upsert_instance,
            remove_instance,
            set_focused,
            probe_env,
            start_instance,
            stop_instance,
            restart_instance,
            open_instance_url,
            list_profiles,
            create_profile,
            dump_config,
            run_plugin,
            list_installed,
            pick_folder,
            fetch_curated,
            fetch_discovery,
            fetch_readme,
            next_instance_port,
            clear_logs
        ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let targets = {
                    let state = app.state::<AppState>();
                    let mut g = state.lock();
                    let instances = g.config.instances.clone();
                    supervisor::begin_stop_all(app, &mut g.supervisor, &instances)
                };
                let joins: Vec<_> = targets
                    .into_iter()
                    .map(|target| {
                        std::thread::spawn(move || {
                            process::kill_stop_target_timeout(target, Duration::from_secs(2))
                        })
                    })
                    .collect();
                for join in joins {
                    let _ = join.join();
                }
            }
        });
}
