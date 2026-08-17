use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::config::Instance;
use crate::supervisor::{ProcStatus, Supervisor};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "启动当前", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止当前", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "在浏览器中打开当前", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &start, &stop, &open, &sep, &quit])?;

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("DSH 控制台")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "start" => crate::tray_start_focused(app),
            "stop" => crate::tray_stop_focused(app),
            "open" => crate::tray_open_focused(app),
            "quit" => crate::quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn refresh_tray(app: &AppHandle, sup: &Supervisor, instances: &[Instance]) {
    let any_ready = instances.iter().any(|i| {
        sup.running
            .get(&i.id)
            .map(|r| r.runtime.status == ProcStatus::Ready)
            .unwrap_or(false)
    });
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(if any_ready {
            "DSH 控制台 · 运行中"
        } else {
            "DSH 控制台"
        }));
    }
}
