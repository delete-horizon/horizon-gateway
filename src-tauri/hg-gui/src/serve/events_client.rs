use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use hg_core::{ServeEvent, SERVE_EVENT_ADDR};
use tauri::{AppHandle, Emitter, Manager};

use super::ensure;

static EXIT_ON_SERVE_STOP: AtomicBool = AtomicBool::new(true);

/// Updates call this before `shutdown_serve`. That event would otherwise `exit` the GUI
/// before the installer process exists.
pub fn set_exit_on_serve_stop(allow: bool) {
    EXIT_ON_SERVE_STOP.store(allow, Ordering::SeqCst);
}

pub fn exit_on_serve_stop() -> bool {
    EXIT_ON_SERVE_STOP.load(Ordering::SeqCst)
}

/// Background thread: subscribe to serve event stream and re-emit to the webview.
pub fn start_event_forwarder(app: AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};

    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::Relaxed) {
        return;
    }

    thread::spawn(move || loop {
        if !ensure::is_backend_active() {
            if super::client::ping().is_ok() {
                let _ = ensure::ensure_running();
            } else {
                thread::sleep(Duration::from_secs(1));
                continue;
            }
        }

        match forward_events(&app) {
            Ok(()) => tracing::info!("[gui] serve event stream disconnected"),
            Err(e) => {
                tracing::debug!("[gui] serve event stream: {e}");
                ensure::mark_inactive();
                let _ = app.emit("backend-unavailable", e.clone());
            }
        }

        thread::sleep(Duration::from_secs(1));
    });
}

fn forward_events(app: &AppHandle) -> Result<(), String> {
    let stream = TcpStream::connect(SERVE_EVENT_ADDR)
        .map_err(|e| format!("connect {SERVE_EVENT_ADDR}: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3600)))
        .ok();

    // Signal GUI that serve backend event connection is established and ready
    let _ = app.emit("serve-ready", ());
    tracing::info!("[gui] serve event stream connected; emitted serve-ready");

    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = line.map_err(|e| format!("read: {e}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let evt: ServeEvent =
            serde_json::from_str(&line).map_err(|e| format!("parse event: {e}"))?;
        match evt.event.as_str() {
            "show-main-window" => {
                let handle = app.clone();
                let _ = handle.clone().run_on_main_thread(move || {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                });
            }
            "serve-stopping" => {
                if !exit_on_serve_stop() {
                    tracing::info!("[gui] serve-stopping ignored; update keeps this process alive");
                    break;
                }
                let handle = app.clone();
                let _ = handle.clone().run_on_main_thread(move || {
                    handle.exit(0);
                });
                break;
            }
            // Preserve string payload for FE `listen<string>("chat-frame-received")`.
            "avatar-catalog-changed" => {
                let _ = crate::comm_overlay::avatar::reload_from_disk();
                let _ = app.emit(&evt.event, evt.payload);
            }
            "chat-frame-received" => {
                if let Some(frame) = evt.payload.as_str() {
                    let _ = app.emit("chat-frame-received", frame.to_string());
                } else {
                    let _ = app.emit("chat-frame-received", evt.payload);
                }
            }
            _ => {
                let _ = app.emit(&evt.event, evt.payload);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{exit_on_serve_stop, set_exit_on_serve_stop};

    #[test]
    fn update_can_keep_the_gui_alive_when_serve_stops() {
        let previous = exit_on_serve_stop();
        set_exit_on_serve_stop(false);
        assert!(!exit_on_serve_stop());
        set_exit_on_serve_stop(true);
        assert!(exit_on_serve_stop());
        set_exit_on_serve_stop(previous);
    }
}
