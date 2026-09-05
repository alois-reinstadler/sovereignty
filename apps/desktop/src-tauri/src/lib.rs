use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, State, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const NATIVE_BLUR: &str = "window.dispatchEvent(new CustomEvent('svrgn:desktop-lock',{detail:'native-blur'}));";
const NATIVE_CLOSE: &str = "window.dispatchEvent(new CustomEvent('svrgn:desktop-lock',{detail:'native-close'}));";

#[derive(Default)]
struct CloseState(AtomicBool);

fn authorize_close(label: &str, pending: &AtomicBool) -> bool {
    label == "main" && pending.compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst).is_ok()
}

fn local_navigation(url: &tauri::Url, development: bool) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none())
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none());
    let dev = development && url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(1420);
    bundled || dev
}

#[tauri::command]
async fn desktop_close_ready(window: WebviewWindow, state: State<'_, CloseState>) -> Result<(), String> {
    if !authorize_close(window.label(), &state.0) {
        return Err("No native close request is pending for this window.".into());
    }
    if let Err(error) = window.destroy() {
        state.0.store(true, Ordering::SeqCst);
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CloseState::default())
        .invoke_handler(tauri::generate_handler![desktop_close_ready])
        .setup(|app| {
            let config = app.config().app.windows.iter().find(|window| window.label == "main").ok_or("Missing main window configuration")?;
            WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(|url| local_navigation(url, cfg!(dev)))
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" { return; }
            let Some(webview) = window.app_handle().get_webview_window("main") else { return; };
            match event {
                WindowEvent::Focused(false) => { let _ = webview.eval(NATIVE_BLUR); }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    window.state::<CloseState>().0.store(true, Ordering::SeqCst);
                    // Fixed event only. No user-controlled interpolation and no timeout
                    // that could destroy the process during an encrypted write.
                    let _ = webview.eval(NATIVE_CLOSE);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Sovereignty desktop application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                // macOS Quit and application exit use the same safe close handshake.
                // After the acknowledged main-window destruction, exit is allowed.
                if let Some(window) = app.get_webview_window("main") {
                    api.prevent_exit();
                    let _ = window.close();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_acknowledgement_requires_main_and_a_single_pending_request() {
        let pending = AtomicBool::new(false);
        assert!(!authorize_close("main", &pending));
        pending.store(true, Ordering::SeqCst);
        assert!(!authorize_close("other", &pending));
        assert!(authorize_close("main", &pending));
        assert!(!authorize_close("main", &pending));
    }
    #[test]
    fn navigation_is_local_and_exact() {
        for url in ["tauri://localhost/", "http://tauri.localhost/"] {
            assert!(local_navigation(&url.parse().unwrap(), false));
        }
        for url in ["https://example.com", "http://tauri.localhost.evil.test", "tauri://evil.test", "http://127.0.0.1:1420", "file:///tmp/index.html", "data:text/html,test", "http://user@tauri.localhost", "http://tauri.localhost:8080"] {
            assert!(!local_navigation(&url.parse().unwrap(), false));
        }
        assert!(local_navigation(&"http://127.0.0.1:1420/".parse().unwrap(), true));
        assert!(!local_navigation(&"http://127.0.0.1:1421/".parse().unwrap(), true));
    }
}
