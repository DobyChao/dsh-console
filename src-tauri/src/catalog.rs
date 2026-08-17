use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const CURATED_URL: &str = "https://awesome-dsh-plugin.com/plugins.json";
const DISCOVERY_URL: &str = "https://api.dshmk.com/";
const CURATED_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPayload {
    pub data: Value,
    pub stale: bool,
    pub fetched_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskCache {
    fetched_at: u64,
    data: Value,
}

fn cache_path(config_dir: &Path, name: &str) -> PathBuf {
    config_dir.join("catalog").join(name)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_cache(path: &Path) -> Option<DiskCache> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_cache(path: &Path, data: &Value) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let cache = DiskCache {
        fetched_at: now_secs(),
        data: data.clone(),
    };
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = fs::write(path, json);
    }
}

async fn http_get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let resp = client
        .get(url)
        .timeout(Duration::from_secs(45))
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("JSON 无效：{e}"))
}

async fn http_get_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| format!("读取失败：{e}"))
}

pub async fn fetch_curated(client: &reqwest::Client, config_dir: &Path) -> CatalogPayload {
    let path = cache_path(config_dir, "curated.json");
    let cached = read_cache(&path);
    if let Some(c) = &cached {
        if now_secs().saturating_sub(c.fetched_at) < CURATED_TTL_SECS {
            return CatalogPayload {
                data: c.data.clone(),
                stale: false,
                fetched_at: Some(c.fetched_at),
                error: None,
            };
        }
    }
    match http_get_json(client, CURATED_URL).await {
        Ok(data) => {
            write_cache(&path, &data);
            CatalogPayload {
                data,
                stale: false,
                fetched_at: Some(now_secs()),
                error: None,
            }
        }
        Err(e) => {
            if let Some(c) = cached {
                CatalogPayload {
                    data: c.data,
                    stale: true,
                    fetched_at: Some(c.fetched_at),
                    error: Some(e),
                }
            } else {
                CatalogPayload {
                    data: Value::Null,
                    stale: true,
                    fetched_at: None,
                    error: Some(e),
                }
            }
        }
    }
}

pub async fn fetch_discovery(client: &reqwest::Client, config_dir: &Path) -> CatalogPayload {
    let path = cache_path(config_dir, "discovery.json");
    let cached = read_cache(&path);
    match http_get_json(client, DISCOVERY_URL).await {
        Ok(data) => {
            let valid = data.get("schemaVersion").and_then(|v| v.as_u64()) == Some(1)
                && data.get("repositories").map(|v| v.is_array()).unwrap_or(false);
            if !valid {
                return stale_or_error(cached, "发现目录 schema 无效，已丢弃。".into());
            }
            write_cache(&path, &data);
            CatalogPayload {
                data,
                stale: false,
                fetched_at: Some(now_secs()),
                error: None,
            }
        }
        Err(e) => stale_or_error(cached, e),
    }
}

fn stale_or_error(cached: Option<DiskCache>, error: String) -> CatalogPayload {
    if let Some(c) = cached {
        CatalogPayload {
            data: c.data,
            stale: true,
            fetched_at: Some(c.fetched_at),
            error: Some(error),
        }
    } else {
        CatalogPayload {
            data: Value::Null,
            stale: true,
            fetched_at: None,
            error: Some(error),
        }
    }
}

pub async fn fetch_readme(client: &reqwest::Client, full_name: &str, branch: Option<&str>) -> Result<String, String> {
    let name = full_name.trim().trim_matches('/');
    if !name.contains('/') || name.contains("..") {
        return Err("仓库名无效".into());
    }
    let mut branches: Vec<String> = Vec::new();
    if let Some(b) = branch.map(str::trim).filter(|s| !s.is_empty()) {
        branches.push(b.to_string());
    }
    for b in ["main", "master"] {
        if !branches.iter().any(|x| x == b) {
            branches.push(b.into());
        }
    }
    let mut last = "无法读取 README".to_string();
    for b in branches {
        let url = format!("https://raw.githubusercontent.com/{name}/{b}/README.md");
        match http_get_text(client, &url).await {
            Ok(text) => return Ok(text),
            Err(e) => last = e,
        }
    }
    Err(last)
}
