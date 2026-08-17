use std::io::Read;
use std::sync::{mpsc, Mutex};

use serde::Serialize;

static SINKS: Mutex<Vec<mpsc::Sender<String>>> = Mutex::new(Vec::new());

pub fn subscribe() -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    SINKS.lock().expect("bridge sinks").push(tx);
    rx
}

pub fn emit(event: &str, payload: &impl Serialize) {
    let Ok(data) = serde_json::to_string(payload) else {
        return;
    };
    let frame = format!("event: {event}\ndata: {data}\n\n");
    let mut sinks = SINKS.lock().expect("bridge sinks");
    sinks.retain(|tx| tx.send(frame.clone()).is_ok());
}

pub struct SseReader {
    rx: mpsc::Receiver<String>,
    buf: Vec<u8>,
}

impl SseReader {
    pub fn new(rx: mpsc::Receiver<String>) -> Self {
        Self { rx, buf: Vec::new() }
    }
}

impl Read for SseReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.buf.is_empty() {
            match self.rx.recv() {
                Ok(chunk) => self.buf = chunk.into_bytes(),
                Err(_) => return Ok(0),
            }
        }
        let n = self.buf.len().min(out.len());
        out[..n].copy_from_slice(&self.buf[..n]);
        self.buf.drain(..n);
        Ok(n)
    }
}
