use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::bridge_events::{self, SseReader};

const ADDR: &str = "127.0.0.1:1422";

/// 允许跨域访问网页桥的来源。浏览器页面必须来自开发服务器或 Tauri；
/// 无 Origin 的请求（curl 等本机工具）放行。
const ALLOWED_ORIGINS: [&str; 4] = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
];

#[derive(Deserialize)]
struct InvokeBody {
    cmd: String,
    #[serde(default)]
    args: Value,
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("dsh-console-http".into())
        .spawn(move || run(app))
        .ok();
}

fn run(app: AppHandle) {
    let server = match Server::http(ADDR) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("网页桥 127.0.0.1:1422 未启动（{e}）。浏览器将只能用预览数据。");
            return;
        }
    };
    eprintln!("网页桥 http://{ADDR}  （浏览器打开 http://localhost:1420/ 会走真实后端）");
    for request in server.incoming_requests() {
        let app = app.clone();
        std::thread::spawn(move || handle_request(app, request));
    }
}

/// 返回请求的 Origin 值；Some 且不在白名单内时拒绝。
fn origin_of(request: &tiny_http::Request) -> Result<Option<String>, String> {
    let header = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .map(|h| h.value.as_str().to_string());
    match header {
        None => Ok(None),
        Some(origin) if is_allowed_origin(&origin) => Ok(Some(origin)),
        Some(origin) => Err(origin),
    }
}

fn is_allowed_origin(origin: &str) -> bool {
    ALLOWED_ORIGINS.contains(&origin)
}

fn handle_request(app: AppHandle, mut request: tiny_http::Request) {
    let origin = match origin_of(&request) {
        Ok(o) => o,
        Err(_) => {
            // 不回显未知 Origin，避免被当作合法跨域目标
            let _ = request.respond(json_response(403, json!({ "ok": false, "error": "forbidden origin" }), None));
            return;
        }
    };
    let method = request.method().clone();
    let url = request.url().split('?').next().unwrap_or("/").to_string();
    if method == Method::Options {
        let _ = request.respond(cors(Response::empty(204), origin.as_deref()));
        return;
    }
    if method == Method::Get && url == "/health" {
        let _ = request.respond(json_response(200, json!({ "ok": true }), origin.as_deref()));
        return;
    }
    if method == Method::Get && url == "/events" {
        let rx = bridge_events::subscribe();
        let reader = SseReader::new(rx);
        let mut response = Response::new(StatusCode(200), Vec::new(), reader, None, None);
        add_cors(&mut response, origin.as_deref());
        if let Ok(h) = Header::from_bytes(b"Content-Type", b"text/event-stream") {
            response.add_header(h);
        }
        if let Ok(h) = Header::from_bytes(b"Cache-Control", b"no-cache") {
            response.add_header(h);
        }
        let _ = request.respond(response);
        return;
    }
    if method == Method::Post && url == "/invoke" {
        let mut body = String::new();
        let _ = request.as_reader().read_to_string(&mut body);
        let reply = match serde_json::from_str::<InvokeBody>(&body) {
            Ok(inv) => crate::http_dispatch(app, &inv.cmd, inv.args),
            Err(e) => json!({ "ok": false, "error": format!("请求无法解析：{e}") }),
        };
        let _ = request.respond(json_response(200, reply, origin.as_deref()));
        return;
    }
    let _ = request.respond(json_response(404, json!({ "ok": false, "error": "not found" }), origin.as_deref()));
}

fn json_response(status: u16, body: Value, origin: Option<&str>) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_string(body.to_string()).with_status_code(status);
    if let Ok(h) = Header::from_bytes(b"Content-Type", b"application/json; charset=utf-8") {
        response.add_header(h);
    }
    // 浏览器页面是跨域访问（localhost:1420 → 127.0.0.1:1422），
    // 放行的 Origin 必须回显 ACAO，否则 fetch 会被 CORS 拦下、探测永远失败
    cors(response, origin)
}

fn cors<R: std::io::Read>(mut response: Response<R>, origin: Option<&str>) -> Response<R> {
    add_cors(&mut response, origin);
    response
}

fn add_cors<R: std::io::Read>(response: &mut Response<R>, origin: Option<&str>) {
    // 只回显白名单内的 Origin，不再放行 *
    if let Some(origin) = origin {
        if let Ok(h) = Header::from_bytes(b"Access-Control-Allow-Origin", origin.as_bytes()) {
            response.add_header(h);
        }
    }
    if let Ok(h) = Header::from_bytes(b"Access-Control-Allow-Headers", b"Content-Type") {
        response.add_header(h);
    }
    if let Ok(h) = Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, POST, OPTIONS") {
        response.add_header(h);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowed_origins_cover_dev_and_tauri() {
        assert!(is_allowed_origin("http://localhost:1420"));
        assert!(is_allowed_origin("http://127.0.0.1:1420"));
        assert!(is_allowed_origin("tauri://localhost"));
        assert!(!is_allowed_origin("https://evil.example"));
        assert!(!is_allowed_origin("http://localhost:1420.evil.example"));
    }

    #[test]
    fn cors_reflects_allowed_origin_only() {
        let mut response = Response::empty(204);
        add_cors(&mut response, Some("http://localhost:1420"));
        let reflected: Vec<String> = response
            .headers()
            .iter()
            .filter(|h| h.field.equiv("Access-Control-Allow-Origin"))
            .map(|h| h.value.as_str().to_string())
            .collect();
        assert_eq!(reflected, vec!["http://localhost:1420".to_string()]);

        let mut no_origin = Response::empty(204);
        add_cors(&mut no_origin, None);
        assert!(no_origin.headers().iter().all(|h| !h.field.equiv("Access-Control-Allow-Origin")));
    }
}
