use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::config::LauncherConfig;
use crate::process::capture_dsh;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved: Option<String>,
    pub builtin: bool,
}

pub fn profile_dir(home: &str, name: &str) -> PathBuf {
    Path::new(home).join("profiles").join(name)
}

pub fn list_profiles(home: &str) -> Vec<ProfileInfo> {
    let root = Path::new(home).join("profiles");
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(&root) else {
        return out;
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let pkg = entry.path().join("package.json");
        if !pkg.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let (kind, note) = match name.as_str() {
            "web" => ("web", None),
            "headless" => ("headless", None),
            _ => (
                "base",
                Some("自定义资档只有 base 层，没有 Web UI。".to_string()),
            ),
        };
        out.push(ProfileInfo {
            name,
            path: crate::config::display_path(&entry.path()),
            kind: kind.into(),
            note: note.map(|s| s.to_string()),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn dump_config(
    cfg: &LauncherConfig,
    home: &str,
    profile: &str,
    cwd: Option<&str>,
) -> Result<String, String> {
    let cap = capture_dsh(
        cfg,
        &["--profile", profile, "--dump-config"],
        home,
        cwd,
        Duration::from_secs(60),
    )?;
    if cap.code != 0 {
        return Err(prefer_err(&cap.stdout, &cap.stderr));
    }
    Ok(cap.stdout)
}

pub fn create_profile(
    cfg: &LauncherConfig,
    home: &str,
    name: &str,
    cwd: Option<&str>,
) -> Result<(), String> {
    validate_profile_name(name)?;
    let cap = capture_dsh(
        cfg,
        &["plugin", "--profile", name, "list"],
        home,
        cwd,
        Duration::from_secs(120),
    )?;
    if cap.code != 0 {
        return Err(prefer_err(&cap.stdout, &cap.stderr));
    }
    Ok(())
}

pub fn validate_profile_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("资档名长度无效".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("资档名只能含字母、数字、连字符和下划线".into());
    }
    Ok(())
}

pub fn run_plugin(
    cfg: &LauncherConfig,
    home: &str,
    profile: &str,
    pnpm_args: &[String],
    cwd: Option<&str>,
) -> Result<String, String> {
    if pnpm_args.is_empty() {
        return Err("缺少插件参数".into());
    }
    let abs: Vec<String> = pnpm_args.iter().map(|a| absolutize_spec(a)).collect();
    let mut extra = vec!["plugin".to_string(), "--profile".to_string(), profile.to_string()];
    extra.extend(abs);
    let refs: Vec<&str> = extra.iter().map(|s| s.as_str()).collect();
    let cap = capture_dsh(cfg, &refs, home, cwd, Duration::from_secs(600))?;
    let mut text = String::new();
    if !cap.stdout.trim().is_empty() {
        text.push_str(&cap.stdout);
    }
    if !cap.stderr.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&cap.stderr);
    }
    if cap.stderr.contains("allowBuilds") || cap.stdout.contains("allowBuilds") {
        text.push_str(
            "\ngit 依赖被 pnpm 拦住了：把上面打印的键写进该 profile 目录的 pnpm-workspace.yaml 或 package.json 的 pnpm.allowBuilds，然后重试。",
        );
    }
    if cap.code != 0 {
        if text.trim().is_empty() {
            return Err(format!("插件命令失败，退出码 {}", cap.code));
        }
        return Err(text);
    }
    Ok(text)
}

pub fn list_installed(
    cfg: &LauncherConfig,
    home: &str,
    profile: &str,
    cwd: Option<&str>,
) -> Result<Vec<InstalledPlugin>, String> {
    let bundles = read_bundles(home, profile);
    let deps_manifest = read_dependencies(home, profile);
    let cap = capture_dsh(
        cfg,
        &[
            "plugin",
            "--profile",
            profile,
            "list",
            "--depth=0",
            "--json",
        ],
        home,
        cwd,
        Duration::from_secs(90),
    );
    let mut listed = match cap {
        Ok(c) if c.code == 0 => parse_pnpm_list(&c.stdout).unwrap_or_default(),
        Ok(c) => {
            if c.stderr.contains("pnpm not found") {
                return Err("pnpm not found on PATH — install pnpm to manage profile plugins".into());
            }
            parse_pnpm_list(&c.stdout).unwrap_or_default()
        }
        Err(_) => Vec::new(),
    };

    if listed.is_empty() && !deps_manifest.is_empty() {
        listed = deps_manifest
            .iter()
            .map(|(name, spec)| InstalledPlugin {
                name: name.clone(),
                from: Some(spec.clone()),
                version: None,
                resolved: None,
                builtin: false,
            })
            .collect();
    }

    for p in &mut listed {
        p.builtin = bundles.contains(&p.name) && !deps_manifest.contains_key(&p.name);
    }

    for name in &bundles {
        if !listed.iter().any(|p| &p.name == name) {
            listed.push(InstalledPlugin {
                name: name.clone(),
                from: None,
                version: None,
                resolved: None,
                builtin: !deps_manifest.contains_key(name),
            });
        }
    }
    listed.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(listed)
}

fn read_manifest(home: &str, profile: &str) -> Option<Value> {
    let path = profile_dir(home, profile).join("package.json");
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn read_bundles(home: &str, profile: &str) -> Vec<String> {
    read_manifest(home, profile)
        .and_then(|v| {
            v.get("dsh")?
                .get("profile")?
                .get("bundles")?
                .as_array()
                .cloned()
        })
        .unwrap_or_default()
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect()
}

fn read_dependencies(home: &str, profile: &str) -> std::collections::BTreeMap<String, String> {
    let mut map = std::collections::BTreeMap::new();
    let Some(v) = read_manifest(home, profile) else {
        return map;
    };
    if let Some(deps) = v.get("dependencies").and_then(|d| d.as_object()) {
        for (k, val) in deps {
            map.insert(k.clone(), val.as_str().unwrap_or("").to_string());
        }
    }
    map
}

fn parse_pnpm_list(stdout: &str) -> Result<Vec<InstalledPlugin>, String> {
    let json_slice = extract_json(stdout).ok_or_else(|| "无法解析 pnpm list JSON".to_string())?;
    let root = json_slice.as_array().and_then(|arr| {
        arr.iter().find(|e| e.get("dependencies").and_then(|d| d.as_object()).is_some())
    }).or_else(|| {
        if json_slice.get("dependencies").is_some() {
            Some(&json_slice)
        } else {
            None
        }
    });
    let Some(root) = root else {
        return Ok(Vec::new());
    };
    let Some(deps) = root.get("dependencies").and_then(|d| d.as_object()) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (name, dep) in deps {
        if !dep.is_object() {
            continue;
        }
        out.push(InstalledPlugin {
            name: name.clone(),
            from: dep.get("from").and_then(|v| v.as_str()).map(|s| s.to_string()),
            version: dep.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()),
            resolved: dep.get("resolved").and_then(|v| v.as_str()).map(|s| s.to_string()),
            builtin: false,
        });
    }
    Ok(out)
}

fn extract_json(s: &str) -> Option<Value> {
    let trimmed = s.trim();
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return Some(v);
    }
    if let Some(i) = trimmed.find('[') {
        if let Ok(v) = serde_json::from_str::<Value>(&trimmed[i..]) {
            return Some(v);
        }
    }
    if let Some(i) = trimmed.find('{') {
        if let Ok(v) = serde_json::from_str::<Value>(&trimmed[i..]) {
            return Some(v);
        }
    }
    None
}

fn absolutize_spec(arg: &str) -> String {
    let (prefix, path) = if let Some(rest) = arg.strip_prefix("file:") {
        ("file:", rest)
    } else if let Some(rest) = arg.strip_prefix("link:") {
        ("link:", rest)
    } else {
        ("", arg)
    };
    let is_rel = path == "."
        || path == ".."
        || path.starts_with("./")
        || path.starts_with(".\\")
        || path.starts_with("../")
        || path.starts_with("..\\");
    if !is_rel {
        return arg.to_string();
    }
    let abs = std::env::current_dir()
        .map(|cwd| cwd.join(path))
        .unwrap_or_else(|_| PathBuf::from(path));
    format!("{prefix}{}", crate::config::display_path(&abs))
}

fn prefer_err(stdout: &str, stderr: &str) -> String {
    let s = stderr.trim();
    if !s.is_empty() {
        return s.to_string();
    }
    let s = stdout.trim();
    if !s.is_empty() {
        return s.to_string();
    }
    "命令失败".into()
}
