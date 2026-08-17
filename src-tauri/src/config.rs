use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Appearance {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DshMode {
    Path,
    Checkout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub display_name: String,
    pub dsh_home: String,
    pub port: u16,
    pub profile: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherConfig {
    pub instances: Vec<Instance>,
    pub focused_id: String,
    pub dsh_mode: DshMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dsh_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_path: Option<String>,
    pub appearance: Appearance,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub dsh_mode: DshMode,
    #[serde(default)]
    pub dsh_path: Option<String>,
    #[serde(default)]
    pub checkout_path: Option<String>,
    pub appearance: Appearance,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstancePatch {
    #[serde(default)]
    pub id: Option<String>,
    pub display_name: String,
    pub dsh_home: String,
    pub port: u16,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

pub fn config_file(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

pub fn default_dsh_home() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".dsh")
}

pub fn default_config() -> LauncherConfig {
    let id = Uuid::new_v4().to_string();
    let home = display_path(&default_dsh_home());
    LauncherConfig {
        instances: vec![Instance {
            id: id.clone(),
            display_name: "默认".into(),
            dsh_home: home,
            port: 3080,
            profile: "web".into(),
            cwd: None,
        }],
        focused_id: id,
        dsh_mode: DshMode::Path,
        dsh_path: None,
        checkout_path: None,
        appearance: Appearance::System,
    }
}

pub fn display_path(path: &Path) -> String {
    dunce::simplified(path).to_string_lossy().into_owned()
}

pub fn normalize_home(path: &str) -> String {
    let trimmed = path.trim();
    let displayed = display_path(Path::new(trimmed));
    if cfg!(windows) {
        displayed.replace('/', "\\").to_lowercase()
    } else {
        displayed
    }
}

pub fn homes_equal(a: &str, b: &str) -> bool {
    normalize_home(a) == normalize_home(b)
}

pub fn load_or_default(config_dir: &Path) -> Result<LauncherConfig, String> {
    fs::create_dir_all(config_dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    let path = config_file(config_dir);
    if !path.exists() {
        let cfg = default_config();
        save(config_dir, &cfg)?;
        return Ok(cfg);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取配置失败：{e}"))?;
    let mut cfg: LauncherConfig =
        serde_json::from_str(&raw).map_err(|e| format!("配置损坏：{e}"))?;
    sanitize(&mut cfg);
    Ok(cfg)
}

pub fn save(config_dir: &Path, cfg: &LauncherConfig) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    let path = config_file(config_dir);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败：{e}"))?;
    fs::write(&tmp, json).map_err(|e| format!("写入配置失败：{e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存配置失败：{e}"))?;
    Ok(())
}

pub fn sanitize(cfg: &mut LauncherConfig) {
    if cfg.instances.is_empty() {
        *cfg = default_config();
        return;
    }
    for inst in &mut cfg.instances {
        inst.dsh_home = display_path(Path::new(inst.dsh_home.trim()));
        if inst.profile.trim().is_empty() {
            inst.profile = "web".into();
        }
        if inst.display_name.trim().is_empty() {
            inst.display_name = "未命名".into();
        }
        if inst.port == 0 {
            inst.port = 3080;
        }
    }
    if !cfg.instances.iter().any(|i| i.id == cfg.focused_id) {
        cfg.focused_id = cfg.instances[0].id.clone();
    }
    if let Some(p) = &cfg.dsh_path {
        if p.trim().is_empty() {
            cfg.dsh_path = None;
        }
    }
    if let Some(p) = &cfg.checkout_path {
        if p.trim().is_empty() {
            cfg.checkout_path = None;
        }
    }
}

pub fn next_port(instances: &[Instance]) -> u16 {
    instances.iter().map(|i| i.port).max().unwrap_or(3079).saturating_add(1)
}

pub fn focused<'a>(cfg: &'a LauncherConfig) -> Option<&'a Instance> {
    cfg.instances
        .iter()
        .find(|i| i.id == cfg.focused_id)
        .or_else(|| cfg.instances.first())
}

pub fn upsert(cfg: &mut LauncherConfig, patch: InstancePatch) -> Result<Instance, String> {
    let home = display_path(Path::new(patch.dsh_home.trim()));
    if home.is_empty() {
        return Err("请填写 DSH_HOME 路径".into());
    }
    if patch.display_name.trim().is_empty() {
        return Err("请填写显示名称".into());
    }
    if patch.port == 0 {
        return Err("端口无效".into());
    }
    let profile = patch
        .profile
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("web")
        .to_string();

    if let Some(id) = patch.id.as_deref() {
        let idx = cfg
            .instances
            .iter()
            .position(|i| i.id == id)
            .ok_or_else(|| "找不到该实例".to_string())?;
        for (i, inst) in cfg.instances.iter().enumerate() {
            if i != idx && homes_equal(&inst.dsh_home, &home) {
                return Err("该 DSH_HOME 已被其它实例使用".into());
            }
        }
        let inst = &mut cfg.instances[idx];
        inst.display_name = patch.display_name.trim().into();
        inst.dsh_home = home;
        inst.port = patch.port;
        inst.profile = profile;
        inst.cwd = patch.cwd.filter(|s| !s.trim().is_empty());
        return Ok(inst.clone());
    }

    for inst in &cfg.instances {
        if homes_equal(&inst.dsh_home, &home) {
            return Err("该 DSH_HOME 已被其它实例使用".into());
        }
    }
    let inst = Instance {
        id: Uuid::new_v4().to_string(),
        display_name: patch.display_name.trim().into(),
        dsh_home: home,
        port: patch.port,
        profile,
        cwd: patch.cwd.filter(|s| !s.trim().is_empty()),
    };
    cfg.instances.push(inst.clone());
    Ok(inst)
}

pub fn remove(cfg: &mut LauncherConfig, id: &str) -> Result<Instance, String> {
    if cfg.instances.len() <= 1 {
        return Err("至少保留一个实例".into());
    }
    let idx = cfg
        .instances
        .iter()
        .position(|i| i.id == id)
        .ok_or_else(|| "找不到该实例".to_string())?;
    let removed = cfg.instances.remove(idx);
    if cfg.focused_id == id {
        cfg.focused_id = cfg.instances[0].id.clone();
    }
    Ok(removed)
}
