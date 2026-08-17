use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::config::{DshMode, LauncherConfig};
use crate::process::{capture, dsh_program_args, parent_exists};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeItem {
    pub id: String,
    pub name: String,
    pub ok: bool,
    pub detail: Option<String>,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvProbe {
    pub ok: bool,
    pub first_failure: Option<String>,
    pub items: Vec<ProbeItem>,
    pub git_ok: bool,
    pub git_hint: Option<String>,
}

pub fn probe(cfg: &LauncherConfig) -> EnvProbe {
    let node = probe_version("node", &["-v".into()], None, "Node.js", "安装 Node 22+ 并确保 node 在 PATH 上。");
    let dsh = probe_dsh(cfg);
    let pnpm = probe_version(
        "pnpm",
        &["-v".into()],
        None,
        "pnpm",
        "install pnpm to manage profile plugins",
    );
    let home = probe_home(cfg);

    let items = vec![node, dsh, pnpm, home];
    let first_failure = items.iter().find(|i| !i.ok).map(|i| i.hint.clone());
    let ok = first_failure.is_none();

    let git = probe_version("git", &["--version".into()], None, "git", "缺少 git 只影响 github: 安装。");
    EnvProbe {
        ok,
        first_failure,
        items,
        git_ok: git.ok,
        git_hint: if git.ok { None } else { Some(git.hint) },
    }
}

fn probe_version(bin: &str, args: &[String], home: Option<&str>, name: &str, hint: &str) -> ProbeItem {
    match capture(bin, args, home, None, Duration::from_secs(12)) {
        Ok(c) if c.code == 0 => {
            let detail = first_line(&c.stdout).or_else(|| first_line(&c.stderr));
            ProbeItem {
                id: bin.into(),
                name: name.into(),
                ok: true,
                detail,
                hint: String::new(),
            }
        }
        Ok(c) => ProbeItem {
            id: bin.into(),
            name: name.into(),
            ok: false,
            detail: first_line(&c.stderr).or_else(|| first_line(&c.stdout)),
            hint: hint.into(),
        },
        Err(e) => ProbeItem {
            id: bin.into(),
            name: name.into(),
            ok: false,
            detail: Some(e),
            hint: hint.into(),
        },
    }
}

fn probe_dsh(cfg: &LauncherConfig) -> ProbeItem {
    let hint = match cfg.dsh_mode {
        DshMode::Path => {
            if cfg.dsh_path.as_deref().map(str::trim).filter(|s| !s.is_empty()).is_some() {
                "检查设置里的 dsh 路径，或改回 PATH 上的 dsh。"
            } else {
                "把 dsh 加到 PATH，或在设置里指定二进制 / harness checkout。"
            }
        }
        DshMode::Checkout => "指向已 pnpm run build 的 harness 仓库根目录。",
    };
    let home = crate::config::focused(cfg).map(|i| i.dsh_home.as_str());
    match dsh_program_args(cfg, &["-V"]) {
        Ok((bin, args)) => match capture(&bin, &args, home, None, Duration::from_secs(20)) {
            Ok(c) if c.code == 0 => {
                let detail = first_line(&c.stdout)
                    .or_else(|| first_line(&c.stderr))
                    .or_else(|| match cfg.dsh_mode {
                        DshMode::Checkout => cfg.checkout_path.clone(),
                        DshMode::Path => cfg.dsh_path.clone().or_else(|| Some("PATH: dsh".into())),
                    });
                ProbeItem {
                    id: "dsh".into(),
                    name: "dsh".into(),
                    ok: true,
                    detail,
                    hint: String::new(),
                }
            }
            Ok(c) => ProbeItem {
                id: "dsh".into(),
                name: "dsh".into(),
                ok: false,
                detail: first_line(&c.stderr).or_else(|| first_line(&c.stdout)),
                hint: hint.into(),
            },
            Err(e) => ProbeItem {
                id: "dsh".into(),
                name: "dsh".into(),
                ok: false,
                detail: Some(e),
                hint: hint.into(),
            },
        },
        Err(e) => ProbeItem {
            id: "dsh".into(),
            name: "dsh".into(),
            ok: false,
            detail: Some(e),
            hint: hint.into(),
        },
    }
}

fn probe_home(cfg: &LauncherConfig) -> ProbeItem {
    let Some(inst) = crate::config::focused(cfg) else {
        return ProbeItem {
            id: "home".into(),
            name: "DSH_HOME".into(),
            ok: false,
            detail: None,
            hint: "没有焦点实例。".into(),
        };
    };
    let path = Path::new(&inst.dsh_home);
    let ok = if path.exists() {
        path.is_dir()
    } else {
        parent_exists(path)
    };
    ProbeItem {
        id: "home".into(),
        name: "DSH_HOME".into(),
        ok,
        detail: Some(inst.dsh_home.clone()),
        hint: if ok {
            String::new()
        } else {
            "焦点实例的 DSH_HOME 父目录不可访问。先建好父文件夹，或换一条路径。".into()
        },
    }
}

fn first_line(s: &str) -> Option<String> {
    s.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|s| s.to_string())
}
