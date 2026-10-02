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

const RESIDENT_COMPOSER_LABEL: &str = "chat-resident";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResidentComposerTarget {
    profile_id: String,
    label: String,
}

fn percent_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

const DOCK_WIDTH: f64 = 240.0;
/// Fixed pixel chrome: search 28 + border 1 + message 30.
const DOCK_CHROME: f64 = 59.0;
const DOCK_ROW: f64 = 22.0;

fn dock_height(rows: u32) -> f64 {
    let rows = rows.clamp(1, 4);
    DOCK_CHROME + f64::from(rows) * DOCK_ROW
}

/// Shared chat dock at the bottom center of the primary monitor.
/// The click coordinates stay in the command so existing callers keep working.
#[tauri::command]
#[specta::specta]
pub async fn open_resident_composer(
    app: AppHandle,
    profile_id: String,
    label: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let _ = (x, y);
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("profile id required".into());
    }
    let label = {
        let trimmed = label.trim();
        if trimmed.is_empty() {
            profile_id.clone()
        } else {
            trimmed.to_string()
        }
    };
    let url = format!(
        "/chat/resident?profileId={}&name={}",
        percent_encode(&profile_id),
        percent_encode(&label),
    );
    let (px, py) = dock_origin(&app, dock_height(3));
    let target = ResidentComposerTarget {
        profile_id,
        label: label.clone(),
    };

    if let Some(window) = app.get_webview_window(RESIDENT_COMPOSER_LABEL) {
        let _ = window.set_size(tauri::LogicalSize::new(DOCK_WIDTH, dock_height(3)));
        window
            .set_position(tauri::PhysicalPosition::new(px, py))
            .map_err(|e| e.to_string())?;
        let _ = window.show();
        let _ = window.emit("resident-composer-target", &target);
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut builder =
        WebviewWindowBuilder::new(&app, RESIDENT_COMPOSER_LABEL, WebviewUrl::App(url.into()))
            .title(label)
            .inner_size(DOCK_WIDTH, dock_height(3))
            .background_color(tauri::webview::Color(15, 23, 42, 255))
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .shadow(false);

    #[cfg(windows)]
    {
        builder = builder.scroll_bar_style(ScrollBarStyle::FluentOverlay);
    }

    let window = builder.build().map_err(|e: tauri::Error| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(px, py))
        .map_err(|e| e.to_string())?;
    let _ = window.emit("resident-composer-target", &target);
    Ok(())
}

/// Resize the dock to an exact logical height and pin it to the bottom center.
#[tauri::command]
#[specta::specta]
pub async fn fit_resident_composer(app: AppHandle, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(RESIDENT_COMPOSER_LABEL) else {
        return Ok(());
    };
    let height = height.clamp(dock_height(1), dock_height(4));
    window
        .set_size(tauri::LogicalSize::new(DOCK_WIDTH, height))
        .map_err(|e| e.to_string())?;
    let (px, py) = dock_origin(&app, height);
    window
        .set_position(tauri::PhysicalPosition::new(px, py))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Bottom center of the primary monitor work area, in physical pixels.
fn dock_origin(app: &AppHandle, height: f64) -> (i32, i32) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return (80, 80);
    };
    let scale = monitor.scale_factor().max(1.0);
    let work = monitor.work_area();
    let width = (DOCK_WIDTH * scale).round() as i32;
    let height = (height * scale).round() as i32;
    let margin = (8.0 * scale).round() as i32;
    let x = work.position.x + (work.size.width as i32 - width) / 2;
    let y = work.position.y + work.size.height as i32 - height - margin;
    (x.max(work.position.x), y.max(work.position.y))
}

const INCOMING_CARDS_LABEL: &str = "chat-incoming";
const CARD_WIDTH: f64 = 280.0;
const CARD_ROW: f64 = 76.0;
const CARD_ROW_COUNTER: f64 = 112.0;
const CARD_ROW_ECHO: f64 = 128.0;

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IncomingCard {
    pub id: String,
    pub room_id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub body: String,
    pub created_at: String,
    /// `in` for a received line, `out` for one this machine sent.
    #[serde(default = "default_card_direction")]
    pub direction: String,
    /// Hit notice with a counter button. Taller than a text card.
    #[serde(default)]
    pub counter: bool,
    /// Local dummy whose inbox this card mirrors. Empty for a real notice.
    #[serde(default)]
    pub echo_from_id: String,
}

fn default_card_direction() -> String {
    "in".into()
}

static INCOMING_CARDS: std::sync::Mutex<Vec<IncomingCard>> = std::sync::Mutex::new(Vec::new());

fn cards_origin(app: &AppHandle, height: f64) -> (i32, i32) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return (80, 80);
    };
    let scale = monitor.scale_factor().max(1.0);
    let work = monitor.work_area();
    let width = (CARD_WIDTH * scale).round() as i32;
    let height = (height * scale).round() as i32;
    let margin = (12.0 * scale).round() as i32;
    let x = work.position.x + work.size.width as i32 - width - margin;
    let y = work.position.y + work.size.height as i32 - height - margin;
    (x.max(work.position.x), y.max(work.position.y))
}

fn ensure_incoming_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(INCOMING_CARDS_LABEL).is_some() {
        return Ok(());
    }
    let height = CARD_ROW;
    let (px, py) = cards_origin(app, height);
    let mut builder = WebviewWindowBuilder::new(
        app,
        INCOMING_CARDS_LABEL,
        WebviewUrl::App("/chat/incoming".into()),
    )
    .title("Messages")
    .inner_size(CARD_WIDTH, height)
    .background_color(tauri::webview::Color(0, 0, 0, 0))
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .shadow(false);
    // macOS only exposes this behind `macos-private-api`, which the release build does not enable.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.transparent(true);
    }

    #[cfg(windows)]
    {
        builder = builder.scroll_bar_style(ScrollBarStyle::FluentOverlay);
    }

    let window = builder.build().map_err(|e: tauri::Error| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(px, py))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn place_incoming_cards(app: &AppHandle, count: usize) -> Result<(), String> {
    ensure_incoming_window(app)?;
    let Some(window) = app.get_webview_window(INCOMING_CARDS_LABEL) else {
        return Ok(());
    };
    if count == 0 {
        let _ = window.hide();
        return Ok(());
    }
    let height = INCOMING_CARDS
        .lock()
        .map(|cards| {
            cards
                .iter()
                .map(|card| {
                    if !card.echo_from_id.is_empty() {
                        CARD_ROW_ECHO
                    } else if card.counter {
                        CARD_ROW_COUNTER
                    } else {
                        CARD_ROW
                    }
                })
                .sum::<f64>()
        })
        .unwrap_or(CARD_ROW)
        .max(CARD_ROW);
    let (px, py) = cards_origin(app, height);
    let _ = window.set_size(tauri::LogicalSize::new(CARD_WIDTH, height));
    window
        .set_position(tauri::PhysicalPosition::new(px, py))
        .map_err(|e| e.to_string())?;
    let _ = window.show();
    Ok(())
}

/// Create the card window ahead of the first message so it can show without a cold start.
#[tauri::command]
#[specta::specta]
pub async fn prepare_incoming_cards(app: AppHandle) -> Result<(), String> {
    ensure_incoming_window(&app)
}

/// Show one incoming chat card on the right edge. The card window reads the list on mount.
#[tauri::command]
#[specta::specta]
pub async fn push_incoming_card(app: AppHandle, card: IncomingCard) -> Result<(), String> {
    let count = {
        let mut cards = INCOMING_CARDS.lock().map_err(|e| e.to_string())?;
        cards.retain(|item| item.id != card.id);
        cards.push(card.clone());
        if cards.len() > 4 {
            let extra = cards.len() - 4;
            cards.drain(0..extra);
        }
        cards.len()
    };
    place_incoming_cards(&app, count)?;
    if let Some(window) = app.get_webview_window(INCOMING_CARDS_LABEL) {
        let _ = window.emit("hg-chat-incoming-card", &card);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn list_incoming_cards() -> Vec<IncomingCard> {
    INCOMING_CARDS
        .lock()
        .map(|cards| cards.clone())
        .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub async fn dismiss_incoming_card(app: AppHandle, id: String) -> Result<(), String> {
    let count = {
        let mut cards = INCOMING_CARDS.lock().map_err(|e| e.to_string())?;
        cards.retain(|item| item.id != id);
        cards.len()
    };
    place_incoming_cards(&app, count)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_incoming_cards(app: AppHandle) -> Result<(), String> {
    if let Ok(mut cards) = INCOMING_CARDS.lock() {
        cards.clear();
    }
    place_incoming_cards(&app, 0)
}

static SHELL_ROLE: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();

pub fn set_shell_role(role: &'static str) {
    let _ = SHELL_ROLE.set(role);
}

/// `hub` or `workspace`. Set when the process starts.
#[tauri::command]
#[specta::specta]
pub fn app_shell_role() -> String {
    SHELL_ROLE.get().copied().unwrap_or("hub").to_string()
}

static PENDING_OPEN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn note_companion_open_from_args() {
    for arg in std::env::args() {
        if let Some(path) = arg.strip_prefix("hg-open:") {
            set_pending_companion_open(path.to_string());
        }
    }
}

pub fn set_pending_companion_open(path: String) {
    if let Ok(mut slot) = PENDING_OPEN.lock() {
        *slot = Some(path);
    }
}

/// Path from `hg-open:` on this process. One-shot so the shell can navigate after mount.
#[tauri::command]
#[specta::specta]
pub fn take_companion_open() -> Option<String> {
    PENDING_OPEN.lock().ok().and_then(|mut slot| slot.take())
}

fn workspace_open_arg(tab: Option<String>) -> Vec<String> {
    let Some(tab) = tab else {
        return Vec::new();
    };
    if !matches!(
        tab.as_str(),
        "workspaces" | "resources" | "chat" | "character" | "avatar"
    ) {
        return Vec::new();
    }
    vec![format!("hg-open:/comm?tab={tab}")]
}

/// Spawn the Comm companion exe. A second launch focuses the existing process.
#[tauri::command]
#[specta::specta]
pub fn open_workspace_app(tab: Option<String>) -> Result<(), String> {
    let exe = crate::serve::workspace_exe_path()?;
    let args = workspace_open_arg(tab);
    crate::serve::spawn_gui_companion(exe, "workspace", &args)
}

/// Spawn or focus the Hub window. Attaches to the serve this process is already using.
#[tauri::command]
#[specta::specta]
pub fn open_hub_app() -> Result<(), String> {
    let exe = crate::serve::hub_exe_path()?;
    crate::serve::spawn_gui_companion(exe, "hub", &[])
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
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
            ])
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
        use base64::Engine;
        use std::process::Command;

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

const ACTION_MENU_LABEL: &str = "chat-action-menu";
const ACTION_MENU_WIDTH: f64 = 220.0;
const ACTION_MENU_HEIGHT: f64 = 212.0;

/// Compact menu aimed at the resident under the cursor. Opens above the avatar.
#[tauri::command]
#[specta::specta]
pub async fn open_resident_action_menu(
    app: AppHandle,
    profile_id: String,
    label: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("profile id required".into());
    }
    let label = {
        let trimmed = label.trim();
        if trimmed.is_empty() {
            profile_id.clone()
        } else {
            trimmed.to_string()
        }
    };
    let url = format!(
        "/chat/resident?profileId={}&name={}&menu=1",
        percent_encode(&profile_id),
        percent_encode(&label),
    );
    let (px, py) = action_menu_origin(&app, x, y);
    let target = ResidentComposerTarget {
        profile_id,
        label: label.clone(),
    };

    if let Some(window) = app.get_webview_window(ACTION_MENU_LABEL) {
        pin_action_menu(&window, px, py)?;
        let _ = window.set_title(&label);
        let _ = window.show();
        let _ = window.emit("resident-action-target", &target);
        remember_action_menu(&window);
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut builder =
        WebviewWindowBuilder::new(&app, ACTION_MENU_LABEL, WebviewUrl::App(url.into()))
            .title(label)
            .inner_size(ACTION_MENU_WIDTH, ACTION_MENU_HEIGHT)
            .background_color(tauri::webview::Color(15, 23, 42, 255))
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .shadow(false);

    #[cfg(windows)]
    {
        builder = builder.scroll_bar_style(ScrollBarStyle::FluentOverlay);
    }

    let window = builder.build().map_err(|e: tauri::Error| e.to_string())?;
    window.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            crate::comm_overlay::presence::set_resident_hit_suppressed(false);
            crate::comm_overlay::presence::set_action_menu_hwnd(0);
        }
    });
    remember_action_menu(&window);
    pin_action_menu(&window, px, py)?;
    let _ = window.emit("resident-action-target", &target);
    Ok(())
}

fn pin_action_menu(window: &tauri::WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(
            ACTION_MENU_WIDTH,
            ACTION_MENU_HEIGHT,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn remember_action_menu(window: &tauri::WebviewWindow) {
    crate::comm_overlay::presence::set_resident_hit_suppressed(true);
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        crate::comm_overlay::presence::set_action_menu_hwnd(hwnd.0 as isize);
    }
}

/// Physical origin just above the cursor, clamped to the primary work area.
fn action_menu_origin(app: &AppHandle, x: f64, y: f64) -> (i32, i32) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return (x.round() as i32, (y - ACTION_MENU_HEIGHT).round() as i32);
    };
    let scale = monitor.scale_factor().max(1.0);
    let work = monitor.work_area();
    let width = (ACTION_MENU_WIDTH * scale).round() as i32;
    let height = (ACTION_MENU_HEIGHT * scale).round() as i32;
    let margin = (6.0 * scale).round() as i32;
    let work_left = work.position.x;
    let work_top = work.position.y;
    let work_right = work_left + work.size.width.cast_signed();
    let work_bottom = work_top + work.size.height.cast_signed();
    let mut left = x.round() as i32;
    let mut top = y.round() as i32 - height - margin;
    if top < work_top + margin {
        top = y.round() as i32 + margin;
    }
    if left + width > work_right - margin {
        left = work_right - width - margin;
    }
    if left < work_left + margin {
        left = work_left + margin;
    }
    if top + height > work_bottom - margin {
        top = (work_bottom - height - margin).max(work_top);
    }
    (left, top)
}
