use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::config::{DshMode, LauncherConfig};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
) -> Result<Child, String> {
    let (bin, args) = dsh_program_args(cfg, extra)?;
    spawn_cmd(&bin, &args, dsh_home, cwd, piped)
}

pub fn spawn_named(
    bin: &str,
    args: &[String],
    dsh_home: Option<&str>,
    cwd: Option<&str>,
    piped: bool,
) -> Result<Child, String> {
    spawn_cmd(bin, args, dsh_home.unwrap_or(""), cwd, piped)
}

fn spawn_cmd(
    bin: &str,
    args: &[String],
    dsh_home: &str,
    cwd: Option<&str>,
    piped: bool,
) -> Result<Child, String> {
    let mut command = hidden_command(bin, args);
    if !dsh_home.trim().is_empty() {
        command.env("DSH_HOME", dsh_home);
    }
    if let Some(dir) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
        command.current_dir(dir);
    }
    if piped {
        command.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null());
    }
    command
        .spawn()
        .map_err(|e| format!("无法启动 {bin}：{e}"))
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
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(bin);
        cmd.args(args);
        #[cfg(unix)]
        unsafe {
            cmd.pre_exec(|| {
                libc::setpgid(0, 0);
                Ok(())
            });
        }
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
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

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
                    let _ = kill_tree(pid);
                    let _ = child.wait();
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

pub fn kill_tree(pid: u32) -> Result<(), String> {
    terminate_tree(pid, false)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if !pid_alive(pid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    terminate_tree(pid, true)?;
    thread::sleep(Duration::from_millis(200));
    Ok(())
}

fn terminate_tree(pid: u32, force: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut args = vec!["/PID".into(), pid.to_string(), "/T".into()];
        if force {
            args.push("/F".into());
        }
        let mut child = spawn_named("taskkill", &args, None, None, true)?;
        let _ = child.wait();
        Ok(())
    }
    #[cfg(unix)]
    {
        let sig = if force { libc::SIGKILL } else { libc::SIGTERM };
        unsafe {
            libc::kill(-(pid as i32), sig);
        }
        Ok(())
    }
}

fn pid_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let args = vec![
            "/FI".into(),
            format!("PID eq {pid}"),
            "/NH".into(),
            "/FO".into(),
            "CSV".into(),
        ];
        match capture("tasklist", &args, None, None, Duration::from_secs(3)) {
            Ok(c) => c.stdout.contains(&pid.to_string()),
            Err(_) => true,
        }
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

pub fn wait_child_exit(mut child: Child, tx: mpsc::Sender<i32>) {
    thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(1);
        let _ = tx.send(code);
    });
}
