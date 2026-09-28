#![allow(unsafe_code)]

use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::{Duration, Instant};

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use windows_sys::Win32::Foundation::{GetLastError, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, SetBkMode, SetTextAlign, SetTextColor, TextOutW, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, FW_SEMIBOLD, HBITMAP, HDC, HGDIOBJ, TA_CENTER, TA_TOP,
    TRANSPARENT,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
    GetSystemMetrics, PeekMessageW, RegisterClassW, ShowWindow, TranslateMessage,
    UpdateLayeredWindow, CS_HREDRAW, CS_VREDRAW, MSG, PM_REMOVE, SM_CXSCREEN, SM_CXVIRTUALSCREEN,
    SM_CYSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SW_HIDE, SW_SHOWNA,
    ULW_ALPHA, WM_DESTROY, WM_LBUTTONDOWN, WM_NCHITTEST, WNDCLASSW, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

use crate::comm_overlay::engine::{ActionKind, Banner, BannerKind, Engine, OverlayTool};
use crate::comm_overlay::presence::CommResidentInput;
use crate::comm_overlay::raster::{rasterize_sprites, SpriteBlit};

const SPRITE_DIB: i32 = 768;
const MAX_SPRITE_WINDOWS: usize = 140;

enum OverlayCmd {
    Play {
        kind: ActionKind,
        seed: Option<u64>,
        count: u32,
        from_label: Option<String>,
    },
    SetTool {
        tool: OverlayTool,
    },
    Catch {
        x: f32,
        y: f32,
    },
    SyncResidents {
        items: Vec<CommResidentInput>,
    },
    ShowBubble {
        profile_id: String,
        text: String,
        ttl_ms: u64,
    },
    Clear,
    Shutdown,
}

struct Shared {
    tx: Mutex<Option<Sender<OverlayCmd>>>,
}

static SHARED: OnceCell<Shared> = OnceCell::new();
static RUNNING: AtomicBool = AtomicBool::new(false);

fn shared() -> &'static Shared {
    SHARED.get_or_init(|| Shared {
        tx: Mutex::new(None),
    })
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_DESTROY => 0,
        WM_NCHITTEST => -1, // HTTRANSPARENT
        WM_LBUTTONDOWN => {
            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) != 0 {
                if let Some(tx) = shared().tx.lock().as_ref() {
                    let _ = tx.send(OverlayCmd::Catch {
                        x: pt.x as f32,
                        y: pt.y as f32,
                    });
                }
            }
            0
        }
        _ => DefWindowProcW(hwnd, msg, w, l),
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn overlay_dims(screen_w: i32, screen_h: i32) -> (i32, i32) {
    (screen_w.max(1), screen_h.max(1))
}

/// Origin and size of every connected monitor. Left/above monitors use a negative origin.
fn virtual_screen() -> (i32, i32, i32, i32) {
    unsafe {
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if w <= 0 || h <= 0 {
            return (
                0,
                0,
                GetSystemMetrics(SM_CXSCREEN).max(1),
                GetSystemMetrics(SM_CYSCREEN).max(1),
            );
        }
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            w,
            h,
        )
    }
}

fn register_class() -> Result<(), String> {
    let class = to_wide("HgCommSprite");
    let hinstance = unsafe { GetModuleHandleW(ptr::null()) };
    let wc = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wnd_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: ptr::null_mut(),
        hCursor: ptr::null_mut(),
        hbrBackground: ptr::null_mut(),
        lpszMenuName: ptr::null(),
        lpszClassName: class.as_ptr(),
    };
    unsafe {
        let _ = RegisterClassW(&wc);
    }
    Ok(())
}

unsafe fn create_sprite_hwnd() -> Result<HWND, String> {
    let class = to_wide("HgCommSprite");
    let name = to_wide("HgCommSprite");
    let hinstance = GetModuleHandleW(ptr::null());
    let hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        class.as_ptr(),
        name.as_ptr(),
        WS_POPUP,
        0,
        0,
        8,
        8,
        ptr::null_mut(),
        ptr::null_mut(),
        hinstance,
        ptr::null(),
    );
    if hwnd.is_null() {
        return Err(format!(
            "CreateWindowExW sprite failed ({})",
            GetLastError()
        ));
    }
    Ok(hwnd)
}

struct DibBucket {
    hdc_screen: HDC,
    hdc_mem: HDC,
    hbmp: HBITMAP,
    old: HGDIOBJ,
    bits: *mut u8,
    width: i32,
    height: i32,
}

impl DibBucket {
    unsafe fn new(width: i32, height: i32) -> Result<Self, String> {
        let px = (width as usize)
            .saturating_mul(height as usize)
            .saturating_mul(4);
        if px == 0 || px > (SPRITE_DIB as usize) * (SPRITE_DIB as usize) * 4 {
            return Err("sprite dib size out of range".into());
        }
        let hdc_screen = GetDC(ptr::null_mut());
        if hdc_screen.is_null() {
            return Err("GetDC failed".into());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(ptr::null_mut(), hdc_screen);
            return Err("CreateCompatibleDC failed".into());
        }
        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;
        let mut bits: *mut std::ffi::c_void = ptr::null_mut();
        let hbmp = CreateDIBSection(hdc_mem, &bmi, DIB_RGB_COLORS, &mut bits, ptr::null_mut(), 0);
        if hbmp.is_null() || bits.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(ptr::null_mut(), hdc_screen);
            return Err("CreateDIBSection failed".into());
        }
        let old = SelectObject(hdc_mem, hbmp as HGDIOBJ);
        Ok(Self {
            hdc_screen,
            hdc_mem,
            hbmp,
            old,
            bits: bits as *mut u8,
            width,
            height,
        })
    }

    unsafe fn blit_sprite(&mut self, hwnd: HWND, sprite: &SpriteBlit) -> Result<(), String> {
        let w = sprite.width as i32;
        let h = sprite.height as i32;
        if w <= 0 || h <= 0 || w > self.width || h > self.height {
            return Err("sprite does not fit dib".into());
        }
        let src = &sprite.rgba;
        let dib_stride = self.width as usize * 4;
        for y in 0..h as usize {
            for x in 0..w as usize {
                let si = (y * sprite.width as usize + x) * 4;
                let di = y * dib_stride + x * 4;
                if si + 3 >= src.len() {
                    continue;
                }
                let a = u16::from(src[si + 3]);
                *self.bits.add(di) = ((u16::from(src[si + 2]) * a) / 255) as u8;
                *self.bits.add(di + 1) = ((u16::from(src[si + 1]) * a) / 255) as u8;
                *self.bits.add(di + 2) = ((u16::from(src[si]) * a) / 255) as u8;
                *self.bits.add(di + 3) = src[si + 3];
            }
        }
        let mut size = SIZE { cx: w, cy: h };
        let mut src_pt = POINT { x: 0, y: 0 };
        let mut dst = POINT {
            x: sprite.dest_x,
            y: sprite.dest_y,
        };
        let mut blend = BLENDFUNCTION {
            BlendOp: 0,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: 1,
        };
        let ok = UpdateLayeredWindow(
            hwnd,
            self.hdc_screen,
            &mut dst,
            &mut size,
            self.hdc_mem,
            &mut src_pt,
            0,
            &mut blend,
            ULW_ALPHA,
        );
        if ok == 0 {
            return Err(format!(
                "UpdateLayeredWindow sprite failed ({})",
                GetLastError()
            ));
        }
        Ok(())
    }
}

impl Drop for DibBucket {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.hdc_mem, self.old);
            DeleteObject(self.hbmp as HGDIOBJ);
            DeleteDC(self.hdc_mem);
            ReleaseDC(ptr::null_mut(), self.hdc_screen);
        }
    }
}

struct SpritePool {
    hwnds: Vec<HWND>,
    dib: DibBucket,
    logged: bool,
}

impl SpritePool {
    unsafe fn new() -> Result<Self, String> {
        register_class()?;
        Ok(Self {
            hwnds: Vec::new(),
            dib: DibBucket::new(SPRITE_DIB, SPRITE_DIB)?,
            logged: false,
        })
    }

    fn present(&mut self, sprites: &[SpriteBlit]) -> Result<(), String> {
        let shown = sprites.len().min(MAX_SPRITE_WINDOWS);
        unsafe {
            while self.hwnds.len() < shown {
                self.hwnds.push(create_sprite_hwnd()?);
            }
            for (i, sprite) in sprites.iter().take(shown).enumerate() {
                let hwnd = self.hwnds[i];
                self.dib.blit_sprite(hwnd, sprite)?;
                ShowWindow(hwnd, SW_SHOWNA);
            }
            for hwnd in self.hwnds.iter().skip(shown) {
                ShowWindow(*hwnd, SW_HIDE);
            }
        }
        Ok(())
    }

    fn hide_all(&self) {
        unsafe {
            for hwnd in &self.hwnds {
                ShowWindow(*hwnd, SW_HIDE);
            }
        }
    }
}

impl Drop for SpritePool {
    fn drop(&mut self) {
        unsafe {
            for hwnd in self.hwnds.drain(..) {
                DestroyWindow(hwnd);
            }
        }
    }
}

fn gdi_banner_sprite(banner: &Banner) -> Option<SpriteBlit> {
    let trimmed = banner.text.trim();
    if trimmed.is_empty() || banner.alpha < 8 {
        return None;
    }
    let chars = trimmed.chars().count().max(1);
    let speech = matches!(banner.kind, BannerKind::Speech);
    let width = ((chars * if speech { 13 } else { 12 }) + 28).clamp(48, 640) as i32;
    let height = if speech { 24i32 } else { 28i32 };
    let font_px = if speech { 18 } else { 22 };
    // COLORREF is 0x00bbggrr
    let color = if speech { 0x002C1228 } else { 0x00F0F0F0 };
    let glyph_a = banner.alpha;
    let px = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    unsafe {
        let hdc_screen = GetDC(ptr::null_mut());
        if hdc_screen.is_null() {
            return None;
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(ptr::null_mut(), hdc_screen);
            return None;
        }
        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;
        let mut bits: *mut std::ffi::c_void = ptr::null_mut();
        let hbmp = CreateDIBSection(hdc_mem, &bmi, DIB_RGB_COLORS, &mut bits, ptr::null_mut(), 0);
        if hbmp.is_null() || bits.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(ptr::null_mut(), hdc_screen);
            return None;
        }
        let old = SelectObject(hdc_mem, hbmp as HGDIOBJ);
        let face = to_wide("Segoe UI");
        let font = CreateFontW(
            font_px,
            0,
            0,
            0,
            FW_SEMIBOLD as i32,
            0,
            0,
            0,
            1,
            0,
            0,
            5,
            0,
            face.as_ptr(),
        );
        if !font.is_null() {
            let old_font = SelectObject(hdc_mem, font as HGDIOBJ);
            SetBkMode(hdc_mem, TRANSPARENT as i32);
            SetTextAlign(hdc_mem, TA_CENTER | TA_TOP);
            SetTextColor(hdc_mem, color);
            let wide = to_wide(trimmed);
            let len = wide.len().saturating_sub(1) as i32;
            let ty = if speech { 3 } else { 4 };
            TextOutW(hdc_mem, width / 2, ty, wide.as_ptr(), len);
            SelectObject(hdc_mem, old_font);
            DeleteObject(font as HGDIOBJ);
        }
        let src = std::slice::from_raw_parts(bits as *const u8, px);
        let mut rgba = vec![0u8; px];
        for (i, chunk) in src.chunks_exact(4).enumerate() {
            let b = chunk[0];
            let g = chunk[1];
            let r = chunk[2];
            let a = if b | g | r == 0 { 0 } else { glyph_a };
            let o = i * 4;
            rgba[o] = r;
            rgba[o + 1] = g;
            rgba[o + 2] = b;
            rgba[o + 3] = a;
        }
        SelectObject(hdc_mem, old);
        DeleteObject(hbmp as HGDIOBJ);
        DeleteDC(hdc_mem);
        ReleaseDC(ptr::null_mut(), hdc_screen);
        Some(SpriteBlit {
            dest_x: (banner.x.round() as i32) - width / 2,
            dest_y: if speech {
                (banner.y.round() as i32) - height / 2
            } else {
                (banner.y.round() as i32) - 2
            },
            width: width as u32,
            height: height as u32,
            rgba,
        })
    }
}

fn collect_sprites(frame: &crate::comm_overlay::engine::Frame) -> Vec<SpriteBlit> {
    let mut sprites = rasterize_sprites(frame);
    for banner in &frame.banners {
        if let Some(sprite) = gdi_banner_sprite(banner) {
            sprites.push(sprite);
        }
    }
    sprites
}

fn pump_peek() {
    unsafe {
        let mut msg = std::mem::zeroed::<MSG>();
        while PeekMessageW(&mut msg, ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

fn read_cursor_client() -> Option<(f32, f32)> {
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut pt) == 0 {
            return None;
        }
    }
    Some((pt.x as f32, pt.y as f32))
}

fn overlay_thread_main(rx: mpsc::Receiver<OverlayCmd>) {
    let (origin_x, origin_y, screen_w, screen_h) = virtual_screen();
    let (mut width, mut height) = overlay_dims(screen_w, screen_h);
    let mut origin_x = origin_x;
    let mut origin_y = origin_y;

    let mut pool = match unsafe { SpritePool::new() } {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("overlay sprite pool: {e}");
            RUNNING.store(false, Ordering::SeqCst);
            *shared().tx.lock() = None;
            return;
        }
    };
    tracing::info!("comm overlay presenter: per-sprite layered windows");
    let mut button_down = false;

    let mut engine = Engine::default();

    'outer: loop {
        let (ox, oy, sw, sh) = virtual_screen();
        origin_x = ox;
        origin_y = oy;
        width = sw.max(1);
        height = sh.max(1);
        engine.set_screen_origin(origin_x as f32, origin_y as f32);

        let idle = engine.is_empty();
        if idle {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(cmd) => {
                    if apply_cmd(&mut engine, width, height, cmd) {
                        break 'outer;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break 'outer,
            }
        }
        while let Ok(cmd) = rx.try_recv() {
            if apply_cmd(&mut engine, width, height, cmd) {
                break 'outer;
            }
        }

        pump_peek();

        if engine.is_empty() {
            pool.hide_all();
            continue;
        }

        let pressed = unsafe { GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000 != 0 };
        if pressed && !button_down {
            if let Some((x, y)) = read_cursor_client() {
                if let Some((id, label)) = engine.resident_at(x, y) {
                    crate::comm_overlay::presence::store_resident_click(
                        id,
                        label,
                        f64::from(x),
                        f64::from(y),
                    );
                } else {
                    let _ = engine.on_click(x, y, width as f32, height as f32);
                }
            }
        }
        button_down = pressed;

        let now = Instant::now();
        let cursor = read_cursor_client();
        let frame = engine.tick(now, width as f32, height as f32, cursor);
        let sprites = collect_sprites(&frame);
        if let Err(e) = pool.present(&sprites) {
            if !pool.logged {
                tracing::warn!("overlay present: {e}");
                pool.logged = true;
            }
        }

        thread::sleep(Duration::from_millis(engine.frame_sleep_ms()));
    }

    pool.hide_all();
    RUNNING.store(false, Ordering::SeqCst);
    *shared().tx.lock() = None;
}

fn apply_cmd(engine: &mut Engine, width: i32, height: i32, cmd: OverlayCmd) -> bool {
    match cmd {
        OverlayCmd::Play {
            kind,
            seed,
            count,
            from_label,
        } => {
            engine.spawn_n(kind, seed, width as f32, height as f32, count, from_label);
            false
        }
        OverlayCmd::SetTool { tool } => {
            engine.set_tool(tool);
            false
        }
        OverlayCmd::Catch { x, y } => {
            let _ = engine.on_click(x, y, width as f32, height as f32);
            false
        }
        OverlayCmd::SyncResidents { items } => {
            engine.sync_residents(&items, width as f32, height as f32);
            false
        }
        OverlayCmd::ShowBubble {
            profile_id,
            text,
            ttl_ms,
        } => {
            engine.show_bubble(
                &profile_id,
                &text,
                Duration::from_millis(ttl_ms.max(400)),
                Instant::now(),
            );
            false
        }
        OverlayCmd::Clear => {
            engine.clear();
            false
        }
        OverlayCmd::Shutdown => true,
    }
}

fn ensure_loop() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let (tx, rx) = mpsc::channel();
    *shared().tx.lock() = Some(tx);
    match thread::Builder::new()
        .name("hg-comm-overlay".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                overlay_thread_main(rx);
            }));
            if let Err(e) = result {
                tracing::error!("comm overlay thread panicked: {e:?}");
            }
            RUNNING.store(false, Ordering::SeqCst);
            *shared().tx.lock() = None;
        }) {
        Ok(_) => {}
        Err(e) => {
            tracing::error!("failed to spawn overlay thread: {e}");
            RUNNING.store(false, Ordering::SeqCst);
            *shared().tx.lock() = None;
        }
    }
}

fn send_cmd(cmd: OverlayCmd) {
    ensure_loop();
    for _ in 0..50 {
        if let Some(tx) = shared().tx.lock().as_ref() {
            let _ = tx.send(cmd);
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub fn play(kind: ActionKind, seed: Option<u64>, count: u32, from_label: Option<String>) {
    send_cmd(OverlayCmd::Play {
        kind,
        seed,
        count,
        from_label,
    });
}

pub fn set_tool(tool: &str) {
    send_cmd(OverlayCmd::SetTool {
        tool: OverlayTool::parse(tool),
    });
}

pub fn clear() {
    send_cmd(OverlayCmd::Clear);
}

pub fn sync_residents(items: Vec<CommResidentInput>) {
    send_cmd(OverlayCmd::SyncResidents { items });
}

pub fn show_bubble(profile_id: &str, text: &str, ttl_ms: u64) {
    send_cmd(OverlayCmd::ShowBubble {
        profile_id: profile_id.to_string(),
        text: text.to_string(),
        ttl_ms,
    });
}
