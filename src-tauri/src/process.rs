use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use process_wrap::std::{ChildWrapper, CommandWrap};

use crate::config::{DshMode, LauncherConfig};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub type WrappedChild = Box<dyn ChildWrapper>;
pub type ChildSlot = Arc<Mutex<Option<WrappedChild>>>;

pub struct Spawned {
    pub child: WrappedChild,
}

/// Taken out of the registry so stop never holds AppState while killing.
pub struct StopTarget {
    pub pid: u32,
    pub child: Option<WrappedChild>,
}

pub struct Captured {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub fn dsh_program_args(cfg: &LauncherConfig, extra: &[&str]) -> Result<(String, Vec<String>), String> {
    match cfg.dsh_mode {
        DshMode::Path => {
            let bin = cfg
                .dsh_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("dsh")
                .to_string();
            Ok((bin, extra.iter().map(|s| (*s).to_string()).collect()))
        }
        DshMode::Checkout => {
            let checkout = cfg
                .checkout_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "未设置 harness checkout 路径".to_string())?;
            let mut args = vec!["--dir".to_string(), checkout.to_string(), "dsh".to_string()];
            args.extend(extra.iter().map(|s| (*s).to_string()));
            Ok(("pnpm".into(), args))
        }
    }
}

pub fn spawn_dsh(
    cfg: &LauncherConfig,
    extra: &[&str],
    dsh_home: &str,
    cwd: Option<&str>,
    piped: bool,
) -> Result<Spawned, String> {
    let (bin, args) = dsh_program_args(cfg, extra)?;
    Ok(Spawned {
        child: spawn_cmd(&bin, &args, dsh_home, cwd, piped)?,
    })
}

pub fn spawn_named(
    bin: &str,
    args: &[String],
    dsh_home: Option<&str>,
    cwd: Option<&str>,
    piped: bool,
) -> Result<WrappedChild, String> {
    spawn_cmd(bin, args, dsh_home.unwrap_or(""), cwd, piped)
}

fn spawn_cmd(
    bin: &str,
    args: &[String],
    dsh_home: &str,
    cwd: Option<&str>,
    piped: bool,
) -> Result<WrappedChild, String> {
    let mut command = hidden_command(bin, args);
    if !dsh_home.trim().is_empty() {
        command.env("DSH_HOME", dsh_home);
    }
    if let Some(dir) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
        command.current_dir(dir);
    }
    if piped {
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
    } else {
        command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
    }

    let mut wrap = CommandWrap::from(command);
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::PROCESS_CREATION_FLAGS;
        // CreationFlags 必须在 JobObject 之前：JobObject 会覆盖 creation_flags，并 OR 上 CREATE_SUSPENDED。
        wrap.wrap(process_wrap::std::CreationFlags(PROCESS_CREATION_FLAGS(
            CREATE_NO_WINDOW,
        )));
        wrap.wrap(process_wrap::std::JobObject);
    }
    #[cfg(unix)]
    {
        wrap.wrap(process_wrap::std::ProcessGroup::leader());
    }
    wrap.spawn().map_err(|e| format!("无法启动 {bin}：{e}"))
}

pub fn hidden_command(bin: &str, args: &[String]) -> Command {
    #[cfg(windows)]
    {
        let mut line = quote_win(bin);
        for a in args {
            line.push(' ');
            line.push_str(&quote_win(a));
        }
        let mut cmd = Command::new("cmd");
        cmd.arg("/D").arg("/C").arg(line);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(bin);
        cmd.args(args);
        cmd
    }
}

#[cfg(windows)]
fn quote_win(arg: &str) -> String {
    if arg.is_empty() {
        return "\"\"".into();
    }
    let needs = arg.bytes().any(|b| {
        matches!(
            b,
            b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'&' | b'|' | b'<' | b'>' | b'^' | b'%' | b'('
                | b')'
        )
    });
    if !needs {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut bs = 0usize;
    for ch in arg.chars() {
        match ch {
            '\\' => bs += 1,
            '"' => {
                out.push_str(&"\\".repeat(bs * 2 + 1));
                out.push('"');
                bs = 0;
            }
            _ => {
                if bs > 0 {
                    out.push_str(&"\\".repeat(bs));
                    bs = 0;
                }
                out.push(ch);
            }
        }
    }
    if bs > 0 {
        out.push_str(&"\\".repeat(bs * 2));
    }
    out.push('"');
    out
}

pub fn capture(
    bin: &str,
    args: &[String],
    dsh_home: Option<&str>,
    cwd: Option<&str>,
    timeout: Duration,
) -> Result<Captured, String> {
    let mut child = spawn_named(bin, args, dsh_home, cwd, true)?;
    let pid = child.id();
    let stdout = child.stdout().take();
    let stderr = child.stderr().take();

    let so = thread::spawn(move || read_all(stdout));
    let se = thread::spawn(move || read_all(stderr));

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = so.join().unwrap_or_default();
                let stderr = se.join().unwrap_or_default();
                let code = status.code().unwrap_or(1);
                return Ok(Captured { code, stdout, stderr });
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = kill_wrapped(child, pid, Duration::from_secs(2));
                    let stdout = so.join().unwrap_or_default();
                    let stderr = se.join().unwrap_or_default();
                    return Err(format!(
                        "命令超时（{}s）\n{stdout}\n{stderr}",
                        timeout.as_secs()
                    ));
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("等待进程失败：{e}")),
        }
    }
}

pub fn capture_dsh(
    cfg: &LauncherConfig,
    extra: &[&str],
    dsh_home: &str,
    cwd: Option<&str>,
    timeout: Duration,
) -> Result<Captured, String> {
    let (bin, args) = dsh_program_args(cfg, extra)?;
    capture(&bin, &args, Some(dsh_home), cwd, timeout)
}

fn read_all<T: Read>(stream: Option<T>) -> String {
    let Some(mut s) = stream else {
        return String::new();
    };
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

pub fn pipe_lines<T: Read + Send + 'static>(
    stream: Option<T>,
    mut on_line: impl FnMut(String) + Send + 'static,
) {
    let Some(stream) = stream else {
        return;
    };
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(l) => on_line(l),
                Err(_) => break,
            }
        }
    });
}

pub fn empty_slot() -> ChildSlot {
    Arc::new(Mutex::new(None))
}

/// Poll `try_wait` without holding AppState. Sends an exit code only if the
/// process exits on its own; dropping the sender means stop took the child.
pub fn watch_child_exit(slot: ChildSlot, tx: mpsc::Sender<i32>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(80));
        let mut g = match slot.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        match g.as_mut() {
            None => return,
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    let _ = tx.send(status.code().unwrap_or(1));
                    return;
                }
                Ok(None) => {}
                Err(_) => {
                    let _ = tx.send(1);
                    return;
                }
            },
        }
    });
}

pub fn kill_stop_target(target: StopTarget) -> bool {
    kill_stop_target_timeout(target, Duration::from_secs(5))
}

pub fn kill_stop_target_timeout(target: StopTarget, timeout: Duration) -> bool {
    let pid = target.pid;
    match target.child {
        Some(child) => kill_wrapped(child, pid, timeout),
        None => {
            force_kill_tree(pid);
            !pid_alive(pid)
        }
    }
}

/// Soft signal (Unix SIGTERM / Windows Job Object terminate) → wait → `kill_tree` fallback.
fn kill_wrapped(mut child: WrappedChild, pid: u32, timeout: Duration) -> bool {
    #[cfg(unix)]
    {
        let _ = child.signal(libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW 收不到 WM_CLOSE；Job Object 的 start_kill 整树终止。
        let _ = child.start_kill();
    }

    if wait_until(&mut child, timeout) {
        force_kill_tree(pid);
        return !pid_alive(pid);
    }

    let _ = child.kill();
    force_kill_tree(pid);
    let _ = wait_until(&mut child, Duration::from_millis(800));
    !pid_alive(pid)
}

fn wait_until(child: &mut WrappedChild, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => return true,
        }
    }
    false
}

fn force_kill_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    let _ = kill_tree::blocking::kill_tree(pid);
}

pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        win_pid_alive(pid)
    }
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
}

pub fn parent_exists(path: &Path) -> bool {
    match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.exists(),
        _ => true,
    }
}

#[cfg(windows)]
fn win_pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, HANDLE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const STILL_ACTIVE: u32 = 259;
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return GetLastError() == ERROR_ACCESS_DENIED;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == STILL_ACTIVE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kill_tree_unknown_pid_does_not_hang() {
        let start = Instant::now();
        force_kill_tree(3_000_001);
        assert!(
            start.elapsed() < Duration::from_secs(8),
            "kill_tree hung on a missing pid"
        );
    }

    #[cfg(windows)]
    #[test]
    fn job_object_stop_reaps_hidden_cmd() {
        let child = spawn_cmd("ping", &["-n".into(), "40".into(), "127.0.0.1".into()], "", None, true)
            .expect("spawn ping");
        let pid = child.id();
        assert!(pid_alive(pid), "ping tree should be alive");
        let start = Instant::now();
        let reaped = kill_wrapped(child, pid, Duration::from_secs(5));
        assert!(
            start.elapsed() < Duration::from_secs(8),
            "stop hung on a CREATE_NO_WINDOW tree"
        );
        assert!(reaped || !pid_alive(pid), "ping tree should be gone");
    }

    #[cfg(unix)]
    #[test]
    fn process_group_stop_reaps_sleep() {
        let child = spawn_cmd("sleep", &["30".into()], "", None, true).expect("spawn sleep");
        let pid = child.id();
        let reaped = kill_wrapped(child, pid, Duration::from_secs(5));
        assert!(reaped || !pid_alive(pid));
    }
}
