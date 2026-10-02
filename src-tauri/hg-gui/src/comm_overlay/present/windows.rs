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
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, GetDC,
    GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, SetBkMode, SetTextAlign,
    SetTextColor, TextOutW, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS,
    FW_SEMIBOLD, HBITMAP, HDC, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTOPRIMARY, TA_CENTER, TA_TOP,
    TRANSPARENT,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
    GetSystemMetrics, GetWindowLongPtrW, PeekMessageW, RegisterClassW, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, TranslateMessage, UpdateLayeredWindow, CS_HREDRAW, CS_VREDRAW,
    GWL_EXSTYLE, GWLP_USERDATA, HWND_TOPMOST, MSG, PM_REMOVE, SET_WINDOW_POS_FLAGS, SM_CXSCREEN,
    SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA, ULW_ALPHA, WM_DESTROY,
    WM_LBUTTONDOWN, WM_NCHITTEST, WM_RBUTTONDOWN, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
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
        anchor: Option<String>,
        attacker: Option<String>,
    },
    SetTool {
        tool: OverlayTool,
    },
    Catch {
        x: f32,
        y: f32,
    },
    /// Click landed on an avatar sprite window, so the window behind did not see it.
    ResidentPointer {
        x: f32,
        y: f32,
        context: bool,
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

fn sprite_captures(hwnd: HWND) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) != 0 }
}

fn post_pointer(context: bool) {
    let mut pt = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return;
    }
    if let Some(tx) = shared().tx.lock().as_ref() {
        let _ = tx.send(OverlayCmd::ResidentPointer {
            x: pt.x as f32,
            y: pt.y as f32,
            context,
        });
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_DESTROY => 0,
        WM_NCHITTEST => {
            if sprite_captures(hwnd) {
                1 // HTCLIENT — avatar keeps the click
            } else {
                -1 // HTTRANSPARENT
            }
        }
        WM_LBUTTONDOWN => {
            if sprite_captures(hwnd) {
                // Left click is sampled below. Swallow it so the page behind does not see it.
            } else {
                let mut pt = POINT { x: 0, y: 0 };
                if GetCursorPos(&mut pt) != 0 {
                    if let Some(tx) = shared().tx.lock().as_ref() {
                        let _ = tx.send(OverlayCmd::Catch {
                            x: pt.x as f32,
                            y: pt.y as f32,
                        });
                    }
                }
            }
            0
        }
        WM_RBUTTONDOWN => {
            if sprite_captures(hwnd) {
                post_pointer(true);
            }
            0
        }
        _ => DefWindowProcW(hwnd, msg, w, l),
    }
}

unsafe fn set_sprite_capture(hwnd: HWND, capture: bool) {
    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
    let next = if capture {
        style & !WS_EX_TRANSPARENT
    } else {
        style | WS_EX_TRANSPARENT
    };
    if next != style {
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;
        let _ = SetWindowPos(hwnd, ptr::null_mut(), 0, 0, 0, 0, flags);
    }
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, isize::from(capture));
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn overlay_dims(screen_w: i32, screen_h: i32) -> (i32, i32) {
    (screen_w.max(1), screen_h.max(1))
}

/// Primary monitor work area in virtual-screen pixels, above the taskbar.
fn primary_screen() -> (i32, i32, i32, i32) {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: std::mem::zeroed(),
            rcWork: std::mem::zeroed(),
            dwFlags: 0,
        };
        if GetMonitorInfoW(monitor, &mut info) != 0 {
            let work = info.rcWork;
            let width = (work.right - work.left).max(1);
            let height = (work.bottom - work.top).max(1);
            return (work.left, work.top, width, height);
        }
        (
            0,
            0,
            GetSystemMetrics(SM_CXSCREEN).max(1),
            GetSystemMetrics(SM_CYSCREEN).max(1),
        )
    }
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

#[derive(Clone, Copy, PartialEq, Eq)]
struct Presented {
    dest_x: i32,
    dest_y: i32,
    width: u32,
    height: u32,
    hash: u64,
    capture: bool,
}

struct SpritePool {
    hwnds: Vec<HWND>,
    shown: Vec<Option<Presented>>,
    dib: DibBucket,
    logged: bool,
}

impl SpritePool {
    unsafe fn new() -> Result<Self, String> {
        register_class()?;
        Ok(Self {
            hwnds: Vec::new(),
            shown: Vec::new(),
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
            self.shown.resize(self.hwnds.len(), None);
            for (i, sprite) in sprites.iter().take(shown).enumerate() {
                let next = Presented {
                    dest_x: sprite.dest_x,
                    dest_y: sprite.dest_y,
                    width: sprite.width,
                    height: sprite.height,
                    hash: fnv64(&sprite.rgba),
                    capture: sprite.capture,
                };
                let prev = self.shown[i];
                if prev == Some(next) {
                    continue;
                }
                let hwnd = self.hwnds[i];
                if let Some(prev) = prev {
                    if prev.width == next.width
                        && prev.height == next.height
                        && prev.hash == next.hash
                    {
                        if prev.capture != next.capture {
                            set_sprite_capture(hwnd, sprite.capture);
                        }
                        if prev.dest_x != next.dest_x || prev.dest_y != next.dest_y {
                            let flags: SET_WINDOW_POS_FLAGS =
                                SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSIZE;
                            let _ = SetWindowPos(
                                hwnd,
                                ptr::null_mut(),
                                sprite.dest_x,
                                sprite.dest_y,
                                0,
                                0,
                                flags,
                            );
                        }
                        self.shown[i] = Some(next);
                        continue;
                    }
                }
                set_sprite_capture(hwnd, sprite.capture);
                self.dib.blit_sprite(hwnd, sprite)?;
                ShowWindow(hwnd, SW_SHOWNA);
                self.shown[i] = Some(next);
            }
            for (i, hwnd) in self.hwnds.iter().enumerate().skip(shown) {
                ShowWindow(*hwnd, SW_HIDE);
                self.shown[i] = None;
            }
        }
        Ok(())
    }

    fn hide_all(&mut self) {
        self.shown.fill(None);
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
            capture: false,
        })
    }
}

struct CachedBanner {
    text: String,
    kind: BannerKind,
    alpha: u8,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

fn banner_cache() -> &'static Mutex<Vec<CachedBanner>> {
    static CACHE: OnceCell<Mutex<Vec<CachedBanner>>> = OnceCell::new();
    CACHE.get_or_init(|| Mutex::new(Vec::new()))
}

fn cached_banner(banner: &Banner) -> Option<SpriteBlit> {
    let text = banner.text.trim();
    if text.is_empty() || banner.alpha < 8 {
        return None;
    }
    if let Some(hit) = banner_cache().lock().iter().find(|item| {
        item.text == text && item.kind == banner.kind && item.alpha == banner.alpha
    }) {
        return Some(place_banner(banner, hit.width, hit.height, hit.rgba.clone()));
    }
    let sprite = gdi_banner_sprite(banner)?;
    let mut cache = banner_cache().lock();
    if cache.len() >= 32 {
        cache.remove(0);
    }
    cache.push(CachedBanner {
        text: text.to_string(),
        kind: banner.kind,
        alpha: banner.alpha,
        width: sprite.width,
        height: sprite.height,
        rgba: sprite.rgba.clone(),
    });
    Some(sprite)
}

fn place_banner(banner: &Banner, width: u32, height: u32, rgba: Vec<u8>) -> SpriteBlit {
    let speech = matches!(banner.kind, BannerKind::Speech);
    let width_i = width as i32;
    let height_i = height as i32;
    SpriteBlit {
        dest_x: (banner.x.round() as i32) - width_i / 2,
        dest_y: if speech {
            (banner.y.round() as i32) - height_i / 2
        } else {
            (banner.y.round() as i32) - 2
        },
        width,
        height,
        rgba,
        capture: false,
    }
}

fn avatar_for_label<'a>(
    sprites: &'a mut [SpriteBlit],
    label: &SpriteBlit,
) -> Option<&'a mut SpriteBlit> {
    let lx = label.dest_x + label.width as i32 / 2;
    let ly = label.dest_y;
    sprites.iter_mut().find(|sprite| {
        if !sprite.capture {
            return false;
        }
        let cx = sprite.dest_x + sprite.width as i32 / 2;
        let bottom = sprite.dest_y + sprite.height as i32;
        (cx - lx).abs() <= 24 && ly + 8 >= sprite.dest_y && ly <= bottom + 36
    })
}

fn attach_label(avatar: &mut SpriteBlit, label: &SpriteBlit) -> bool {
    let left = avatar.dest_x.min(label.dest_x);
    let top = avatar.dest_y.min(label.dest_y);
    let right = (avatar.dest_x + avatar.width as i32).max(label.dest_x + label.width as i32);
    let bottom = (avatar.dest_y + avatar.height as i32).max(label.dest_y + label.height as i32);
    let width = (right - left).max(1) as u32;
    let height = (bottom - top).max(1) as u32;
    if width > SPRITE_DIB as u32 || height > SPRITE_DIB as u32 {
        return false;
    }
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    blit_over(&mut rgba, width, avatar, left, top);
    blit_over(&mut rgba, width, label, left, top);
    avatar.dest_x = left;
    avatar.dest_y = top;
    avatar.width = width;
    avatar.height = height;
    avatar.rgba = rgba;
    true
}

fn blit_over(dst: &mut [u8], dst_w: u32, src: &SpriteBlit, origin_x: i32, origin_y: i32) {
    let ox = (src.dest_x - origin_x) as usize;
    let oy = (src.dest_y - origin_y) as usize;
    let dst_w = dst_w as usize;
    for y in 0..src.height as usize {
        for x in 0..src.width as usize {
            let si = (y * src.width as usize + x) * 4;
            if si + 3 >= src.rgba.len() || src.rgba[si + 3] == 0 {
                continue;
            }
            let di = ((oy + y) * dst_w + (ox + x)) * 4;
            if di + 3 >= dst.len() {
                continue;
            }
            dst[di..di + 4].copy_from_slice(&src.rgba[si..si + 4]);
        }
    }
}

fn fnv64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn collect_sprites(frame: &crate::comm_overlay::engine::Frame) -> Vec<SpriteBlit> {
    let mut sprites = rasterize_sprites(frame);
    let mut loose = Vec::new();
    for banner in &frame.banners {
        let Some(label) = cached_banner(banner) else {
            continue;
        };
        if banner.kind == BannerKind::Label {
            if let Some(avatar) = avatar_for_label(&mut sprites, &label) {
                if attach_label(avatar, &label) {
                    continue;
                }
            }
        }
        loose.push(label);
    }
    sprites.extend(loose);
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
        let (px, py, pw, ph) = primary_screen();
        engine.set_walk_bounds(px as f32, py as f32, pw as f32, ph as f32);

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
        while let Ok(cmd) = rx.try_recv() {
            if apply_cmd(&mut engine, width, height, cmd) {
                break 'outer;
            }
        }

        if engine.is_empty() {
            pool.hide_all();
            continue;
        }

        let suppressed = crate::comm_overlay::presence::resident_hits_suppressed();
        let pressed = unsafe { GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000 != 0 };
        // Left click stays the composer. While the action menu is open, ignore it so
        // the menu buttons are not also a resident click.
        if !suppressed && pressed && !button_down {
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
        raise_action_menu();

        thread::sleep(Duration::from_millis(engine.frame_sleep_ms()));
    }

    pool.hide_all();
    RUNNING.store(false, Ordering::SeqCst);
    *shared().tx.lock() = None;
}

fn raise_action_menu() {
    let raw = crate::comm_overlay::presence::action_menu_hwnd();
    if raw == 0 {
        return;
    }
    let flags: SET_WINDOW_POS_FLAGS = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
    unsafe {
        let _ = SetWindowPos(raw as HWND, HWND_TOPMOST, 0, 0, 0, 0, flags);
    }
}

fn apply_cmd(engine: &mut Engine, width: i32, height: i32, cmd: OverlayCmd) -> bool {
    match cmd {
        OverlayCmd::Play {
            kind,
            seed,
            count,
            from_label,
            anchor,
            attacker,
        } => {
            let lunged = attacker.as_deref().is_some_and(|id| {
                anchor.as_deref().is_some_and(|target| engine.begin_strike(id, target, kind))
            });
            if !lunged {
                engine.spawn_n(
                    kind,
                    seed,
                    width as f32,
                    height as f32,
                    count,
                    from_label,
                    anchor,
                );
            }
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
        OverlayCmd::ResidentPointer { x, y, context } => {
            if let Some((id, label)) = engine.resident_at(x, y) {
                if context {
                    crate::comm_overlay::presence::store_resident_context(
                        id,
                        label,
                        f64::from(x),
                        f64::from(y),
                    );
                } else if !crate::comm_overlay::presence::resident_hits_suppressed() {
                    crate::comm_overlay::presence::store_resident_click(
                        id,
                        label,
                        f64::from(x),
                        f64::from(y),
                    );
                }
            }
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

pub fn play(
    kind: ActionKind,
    seed: Option<u64>,
    count: u32,
    from_label: Option<String>,
    anchor: Option<String>,
    attacker: Option<String>,
) {
    send_cmd(OverlayCmd::Play {
        kind,
        seed,
        count,
        from_label,
        anchor,
        attacker,
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
