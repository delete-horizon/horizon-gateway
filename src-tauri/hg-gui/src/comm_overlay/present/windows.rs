#![allow(unsafe_code)]

use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HGDIOBJ,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetSystemMetrics,
    PeekMessageW, RegisterClassW, ShowWindow, TranslateMessage, UpdateLayeredWindow, CS_HREDRAW,
    CS_VREDRAW, MSG, PM_REMOVE, SM_CXSCREEN, SM_CYSCREEN, SW_HIDE, SW_SHOWNA, ULW_ALPHA,
    WM_DESTROY, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};

use crate::comm_overlay::engine::{ActionKind, Engine};
use crate::comm_overlay::raster::rasterize;

struct OverlayState {
    engine: Engine,
    hwnd: usize,
    width: i32,
    height: i32,
}

static STATE: OnceCell<Mutex<Option<OverlayState>>> = OnceCell::new();
static RUNNING: AtomicBool = AtomicBool::new(false);

fn state() -> &'static Mutex<Option<OverlayState>> {
    STATE.get_or_init(|| Mutex::new(None))
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if msg == WM_DESTROY {
        return 0;
    }
    DefWindowProcW(hwnd, msg, w, l)
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
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
        WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
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

unsafe fn blit(hwnd: HWND, width: i32, height: i32, pixels: &[u8]) -> Result<(), String> {
    let mut bgra = vec![0u8; pixels.len()];
    for (i, chunk) in pixels.chunks_exact(4).enumerate() {
        let r = chunk[0] as u16;
        let g = chunk[1] as u16;
        let b = chunk[2] as u16;
        let a = chunk[3] as u16;
        let o = i * 4;
        bgra[o] = ((b * a) / 255) as u8;
        bgra[o + 1] = ((g * a) / 255) as u8;
        bgra[o + 2] = ((r * a) / 255) as u8;
        bgra[o + 3] = a as u8;
    }

    let hdc_screen = GetDC(ptr::null_mut());
    let hdc_mem = CreateCompatibleDC(hdc_screen);
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
    ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
    let old = SelectObject(hdc_mem, hbmp as HGDIOBJ);

    let mut size = SIZE {
        cx: width,
        cy: height,
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
        hdc_screen,
        &mut dst,
        &mut size,
        hdc_mem,
        &mut src,
        0,
        &mut blend,
        ULW_ALPHA,
    );
    SelectObject(hdc_mem, old);
    DeleteObject(hbmp as HGDIOBJ);
    DeleteDC(hdc_mem);
    ReleaseDC(ptr::null_mut(), hdc_screen);
    if ok == 0 {
        return Err("UpdateLayeredWindow failed".into());
    }
    Ok(())
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

fn ensure_loop() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(|| {
        let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
        let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
        let hwnd = match unsafe { ensure_window(width, height) } {
            Ok(h) => h,
            Err(e) => {
                tracing::error!("overlay window: {e}");
                RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };
        {
            let mut g = state().lock();
            *g = Some(OverlayState {
                engine: Engine::default(),
                hwnd: hwnd as usize,
                width,
                height,
            });
        }

        loop {
            pump_peek();
            let frame_data = {
                let mut g = state().lock();
                let Some(st) = g.as_mut() else {
                    break;
                };
                if st.engine.is_empty() {
                    unsafe {
                        ShowWindow(st.hwnd as HWND, SW_HIDE);
                    }
                    drop(g);
                    thread::sleep(Duration::from_millis(50));
                    continue;
                }
                let now = Instant::now();
                let frame = st.engine.tick(now, st.width as f32, st.height as f32);
                let empty = st.engine.is_empty();
                let hwnd = st.hwnd as HWND;
                let w = st.width as u32;
                let h = st.height as u32;
                (frame, empty, hwnd, w, h)
            };

            if let Some(pm) = rasterize(&frame_data.0, frame_data.3, frame_data.4) {
                let _ = unsafe {
                    blit(
                        frame_data.2,
                        frame_data.3 as i32,
                        frame_data.4 as i32,
                        pm.data(),
                    )
                };
                unsafe {
                    ShowWindow(frame_data.2, SW_SHOWNA);
                }
            }
            if frame_data.1 {
                unsafe {
                    ShowWindow(frame_data.2, SW_HIDE);
                }
            }
            thread::sleep(Duration::from_millis(16));
        }

        if let Some(st) = state().lock().take() {
            unsafe {
                DestroyWindow(st.hwnd as HWND);
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

pub fn play(kind: ActionKind, seed: Option<u64>) {
    ensure_loop();
    for _ in 0..50 {
        if state().lock().is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    if let Some(st) = state().lock().as_mut() {
        st.engine
            .spawn(kind, seed, st.width as f32, st.height as f32);
        unsafe {
            ShowWindow(st.hwnd as HWND, SW_SHOWNA);
        }
    }
}

pub fn clear() {
    if let Some(st) = state().lock().as_mut() {
        st.engine.clear();
        unsafe {
            ShowWindow(st.hwnd as HWND, SW_HIDE);
        }
    }
}
