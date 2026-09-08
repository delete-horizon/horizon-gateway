#![allow(unsafe_code)]

use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::{Duration, Instant};

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetSystemMetrics,
    PeekMessageW, RegisterClassW, ShowWindow, TranslateMessage, UpdateLayeredWindow, CS_HREDRAW,
    CS_VREDRAW, MSG, PM_REMOVE, SM_CXSCREEN, SM_CYSCREEN, SW_HIDE, SW_SHOWNA, ULW_ALPHA,
    WM_DESTROY, WM_LBUTTONDOWN, WM_NCHITTEST, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use crate::comm_overlay::engine::{ActionKind, Engine};
use crate::comm_overlay::raster::rasterize_into;

enum OverlayCmd {
    Play { kind: ActionKind, seed: Option<u64> },
    Catch { x: f32, y: f32 },
    Clear,
    Shutdown,
}

struct Shared {
    tx: Mutex<Option<Sender<OverlayCmd>>>,
}

/// Catchable hit circles in overlay client coords (x, y, radius).
static HIT_TARGETS: OnceCell<Mutex<Vec<(f32, f32, f32)>>> = OnceCell::new();
static SHARED: OnceCell<Shared> = OnceCell::new();
static RUNNING: AtomicBool = AtomicBool::new(false);

fn shared() -> &'static Shared {
    SHARED.get_or_init(|| Shared {
        tx: Mutex::new(None),
    })
}

fn hit_targets() -> &'static Mutex<Vec<(f32, f32, f32)>> {
    HIT_TARGETS.get_or_init(|| Mutex::new(Vec::new()))
}

fn hit_test_client(x: f32, y: f32) -> bool {
    hit_targets().lock().iter().any(|&(tx, ty, r)| {
        let dx = tx - x;
        let dy = ty - y;
        dx * dx + dy * dy <= r * r
    })
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_DESTROY => 0,
        WM_NCHITTEST => {
            // Overlay sits at (0,0); screen coords map to client for the primary top-left canvas.
            let sx = (l & 0xFFFF) as i16 as f32;
            let sy = ((l >> 16) & 0xFFFF) as i16 as f32;
            if hit_test_client(sx, sy) {
                1 // HTCLIENT
            } else {
                -1 // HTTRANSPARENT — pass click through
            }
        }
        WM_LBUTTONDOWN => {
            let x = (l & 0xFFFF) as i16 as f32;
            let y = ((l >> 16) & 0xFFFF) as i16 as f32;
            if let Some(tx) = shared().tx.lock().as_ref() {
                let _ = tx.send(OverlayCmd::Catch { x, y });
            }
            0
        }
        _ => DefWindowProcW(hwnd, msg, w, l),
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Primary-monitor pixel size with a hard pixel budget (avoids OOM on exotic setups).
fn overlay_dims(screen_w: i32, screen_h: i32) -> (i32, i32) {
    const MAX_PX: i32 = 3840 * 2160;
    let w = screen_w.max(1);
    let h = screen_h.max(1);
    if w.saturating_mul(h) <= MAX_PX {
        return (w, h);
    }
    let scale = ((MAX_PX as f32) / (w as f32 * h as f32)).sqrt().min(1.0);
    (
        ((w as f32) * scale).round().max(1.0) as i32,
        ((h as f32) * scale).round().max(1.0) as i32,
    )
}

unsafe fn ensure_window(width: i32, height: i32) -> Result<HWND, String> {
    let class = to_wide("HgCommOverlay");
    let name = to_wide("HgCommOverlay");
    let hinstance = GetModuleHandleW(ptr::null());
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
    let _ = RegisterClassW(&wc);

    let hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        class.as_ptr(),
        name.as_ptr(),
        WS_POPUP,
        0,
        0,
        width,
        height,
        ptr::null_mut(),
        ptr::null_mut(),
        hinstance,
        ptr::null(),
    );
    if hwnd.is_null() {
        return Err("CreateWindowExW failed".into());
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
    bgra: Vec<u8>,
}

impl DibBucket {
    unsafe fn new(width: i32, height: i32) -> Result<Self, String> {
        let px = (width as usize).saturating_mul(height as usize).saturating_mul(4);
        if px == 0 || px > 3840 * 2160 * 4 {
            return Err("overlay size out of range".into());
        }
        let mut bgra = Vec::new();
        bgra.try_reserve_exact(px).map_err(|_| "overlay OOM".to_string())?;
        bgra.resize(px, 0);

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
        let hbmp = CreateDIBSection(
            hdc_mem,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            ptr::null_mut(),
            0,
        );
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
            bgra,
        })
    }

    unsafe fn blit(&mut self, hwnd: HWND, rgba: &[u8]) -> Result<(), String> {
        if rgba.len() != self.bgra.len() {
            return Err("pixel buffer size mismatch".into());
        }
        for (i, chunk) in rgba.chunks_exact(4).enumerate() {
            let r = chunk[0] as u16;
            let g = chunk[1] as u16;
            let b = chunk[2] as u16;
            let a = chunk[3] as u16;
            let o = i * 4;
            self.bgra[o] = ((b * a) / 255) as u8;
            self.bgra[o + 1] = ((g * a) / 255) as u8;
            self.bgra[o + 2] = ((r * a) / 255) as u8;
            self.bgra[o + 3] = a as u8;
        }
        ptr::copy_nonoverlapping(self.bgra.as_ptr(), self.bits, self.bgra.len());

        let mut size = SIZE {
            cx: self.width,
            cy: self.height,
        };
        let mut src = POINT { x: 0, y: 0 };
        let mut dst = POINT { x: 0, y: 0 };
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
            &mut src,
            0,
            &mut blend,
            ULW_ALPHA,
        );
        if ok == 0 {
            return Err("UpdateLayeredWindow failed".into());
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
    // Overlay window is created at primary origin (0,0).
    Some((pt.x as f32, pt.y as f32))
}

fn overlay_thread_main(rx: mpsc::Receiver<OverlayCmd>) {
    let screen_w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let screen_h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    let (width, height) = overlay_dims(screen_w, screen_h);

    let hwnd = match unsafe { ensure_window(width, height) } {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("overlay window: {e}");
            RUNNING.store(false, Ordering::SeqCst);
            *shared().tx.lock() = None;
            return;
        }
    };

    let mut dib = match unsafe { DibBucket::new(width, height) } {
        Ok(d) => d,
        Err(e) => {
            tracing::error!("overlay dib: {e}");
            unsafe {
                DestroyWindow(hwnd);
            }
            RUNNING.store(false, Ordering::SeqCst);
            *shared().tx.lock() = None;
            return;
        }
    };

    let mut engine = Engine::default();
    let mut pixmap = match tiny_skia::Pixmap::new(width as u32, height as u32) {
        Some(p) => p,
        None => {
            tracing::error!("overlay pixmap alloc failed");
            unsafe {
                DestroyWindow(hwnd);
            }
            RUNNING.store(false, Ordering::SeqCst);
            *shared().tx.lock() = None;
            return;
        }
    };

    let mut visible = false;

    'outer: loop {
        // Drain commands without blocking when animating; block briefly when idle.
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
            if visible {
                *hit_targets().lock() = Vec::new();
                unsafe {
                    ShowWindow(hwnd, SW_HIDE);
                }
                visible = false;
            }
            continue;
        }

        let now = Instant::now();
        let cursor = read_cursor_client();
        let frame = engine.tick(now, width as f32, height as f32, cursor);
        *hit_targets().lock() = engine.catch_targets();
        rasterize_into(&frame, &mut pixmap);
        if let Err(e) = unsafe { dib.blit(hwnd, pixmap.data()) } {
            tracing::warn!("overlay blit: {e}");
        } else if !visible {
            unsafe {
                ShowWindow(hwnd, SW_SHOWNA);
            }
            visible = true;
        }

        if engine.is_empty() && visible {
            *hit_targets().lock() = Vec::new();
            unsafe {
                ShowWindow(hwnd, SW_HIDE);
            }
            visible = false;
        }

        thread::sleep(Duration::from_millis(33));
    }

    unsafe {
        ShowWindow(hwnd, SW_HIDE);
        DestroyWindow(hwnd);
    }
    RUNNING.store(false, Ordering::SeqCst);
    *shared().tx.lock() = None;
}

fn apply_cmd(engine: &mut Engine, width: i32, height: i32, cmd: OverlayCmd) -> bool {
    match cmd {
        OverlayCmd::Play { kind, seed } => {
            engine.spawn(kind, seed, width as f32, height as f32);
            false
        }
        OverlayCmd::Catch { x, y } => {
            let _ = engine.try_catch(x, y);
            *hit_targets().lock() = engine.catch_targets();
            false
        }
        OverlayCmd::Clear => {
            engine.clear();
            *hit_targets().lock() = Vec::new();
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
    // Wait briefly for the worker to publish its sender (already set before spawn).
    for _ in 0..50 {
        if let Some(tx) = shared().tx.lock().as_ref() {
            let _ = tx.send(cmd);
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub fn play(kind: ActionKind, seed: Option<u64>) {
    // Never touch HWND from the Tauri command thread — only enqueue.
    send_cmd(OverlayCmd::Play { kind, seed });
}

pub fn clear() {
    send_cmd(OverlayCmd::Clear);
}
