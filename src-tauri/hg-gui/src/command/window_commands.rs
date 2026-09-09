#[cfg(windows)]
use tauri::webview::ScrollBarStyle;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
#[specta::specta]
pub async fn open_window(
    app: AppHandle,
    label: String,
    title: String,
    url: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(width, height)
        .decorations(false);

    #[cfg(windows)]
    {
        builder = builder.scroll_bar_style(ScrollBarStyle::FluentOverlay);
    }

    let _window = builder.build().map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_inspector_window(
    app: AppHandle,
    url: String,
    script: Option<String>,
) -> Result<(), String> {
    let label = "inspector";

    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }

    let parsed_url = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    let mut builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed_url))
        .title("UI Inspector")
        .inner_size(1280.0, 800.0);

    if let Some(s) = script {
        builder = builder.initialization_script(&s);
    }

    builder.build().map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_annotation_dialog(
    app: AppHandle,
    selector: String,
    content: String,
    tag_name: String,
    thumbnail: String,
) -> Result<(), String> {
    app.emit(
        "annotation-dialog-requested",
        serde_json::json!({
            "selector": selector,
            "content": content,
            "tagName": tag_name,
            "thumbnail": thumbnail,
        }),
    )
    .map_err(|e: tauri::Error| e.to_string())?;

    if let Some(main) = app.get_webview_window("main") {
        main.set_focus().map_err(|e: tauri::Error| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn quit_app(app: AppHandle) -> Result<(), String> {
    crate::serve::kill_serve_process();
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn prepare_for_update() -> Result<(), String> {
    tracing::info!("[gui] prepare_for_update: stopping serve process before update installation");
    crate::serve::kill_serve_process();
    crate::serve::mark_inactive();

    for _ in 0..30 {
        if crate::serve::leftover_is_gone() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
    Ok(())
}

/// Restart hg-serve after a cancelled/failed update left the backend stopped.
#[tauri::command]
#[specta::specta]
pub fn ensure_serve_running() -> Result<(), String> {
    tracing::info!("[gui] ensure_serve_running: recovering backend after update failure");
    crate::serve::ensure_running()
}

#[tauri::command]
#[specta::specta]
pub async fn capture_app_screenshot(_app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let script = r#"
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $ms.ToArray()
$g.Dispose()
$bmp.Dispose()
$ms.Dispose()
[Convert]::ToBase64String($bytes)
"#;

        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script])
            .output()
            .map_err(|e| format!("Failed to execute powershell screenshot: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Screenshot capture failed: {stderr}"));
        }

        let base64_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if base64_str.is_empty() {
            return Err("Screenshot captured empty buffer".to_string());
        }

        Ok(format!("data:image/png;base64,{base64_str}"))
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        use base64::Engine;

        let temp_path = std::env::temp_dir().join("hg_screenshot.png");
        let output = Command::new("screencapture")
            .args(["-x", temp_path.to_str().unwrap_or("/tmp/hg_screenshot.png")])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err("macOS screencapture failed".to_string());
        }

        let bytes = std::fs::read(&temp_path).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&temp_path);
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(format!("data:image/png;base64,{encoded}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("OS native window screenshot not supported on this platform".to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn trigger_os_snip() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "ms-screenclip:"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("screencapture")
            .args(["-i", "-c"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("OS native snipping tool not supported on this platform".to_string())
    }
}

