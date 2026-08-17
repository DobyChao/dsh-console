use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::bridge_events::{self, SseReader};

const ADDR: &str = "127.0.0.1:1422";

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

fn handle_request(app: AppHandle, mut request: tiny_http::Request) {
    let method = request.method().clone();
    let url = request.url().split('?').next().unwrap_or("/").to_string();
    if method == Method::Options {
        let _ = request.respond(cors(Response::empty(204)));
        return;
    }
    if method == Method::Get && url == "/health" {
        let _ = request.respond(json_response(200, json!({ "ok": true })));
        return;
    }
    if method == Method::Get && url == "/events" {
        let rx = bridge_events::subscribe();
        let reader = SseReader::new(rx);
        let mut response = Response::new(StatusCode(200), Vec::new(), reader, None, None);
        add_cors(&mut response);
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
        let _ = request.respond(json_response(200, reply));
        return;
    }
    let _ = request.respond(json_response(404, json!({ "ok": false, "error": "not found" })));
}

fn json_response(status: u16, body: Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_string(body.to_string()).with_status_code(status);
    if let Ok(h) = Header::from_bytes(b"Content-Type", b"application/json; charset=utf-8") {
        response.add_header(h);
    }
    cors(response)
}

fn cors<R: std::io::Read>(mut response: Response<R>) -> Response<R> {
    add_cors(&mut response);
    response
}

fn add_cors<R: std::io::Read>(response: &mut Response<R>) {
    if let Ok(h) = Header::from_bytes(b"Access-Control-Allow-Origin", b"*") {
        response.add_header(h);
    }
    if let Ok(h) = Header::from_bytes(b"Access-Control-Allow-Headers", b"Content-Type") {
        response.add_header(h);
    }
    if let Ok(h) = Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, POST, OPTIONS") {
        response.add_header(h);
    }
}
