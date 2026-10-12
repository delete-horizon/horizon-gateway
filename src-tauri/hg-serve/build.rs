use std::{env, fs, path::PathBuf};

fn main() {
    embed_inspector_js();
    copy_tray_icon();
    #[cfg(windows)]
    {
        embed_admin_manifest();
        copy_windivert_sidecars();
    }
}

fn copy_tray_icon() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let src = manifest_dir
        .join("..")
        .join("hg-gui")
        .join("icons")
        .join("icon.ico");
    println!("cargo:rerun-if-changed=../hg-gui/icons/icon.ico");
    if !src.is_file() {
        return;
    }
    let Some(dir) = profile_output_dir() else {
        return;
    };
    let _ = fs::copy(&src, dir.join("icon.ico"));
}

/// `windivert` links `WinDivert.dll` dynamically. The loader only searches next
/// to the exe (then System32 and PATH), so a copy left in the crate `OUT_DIR`
/// exits the process with `STATUS_DLL_NOT_FOUND` (0xC0000135) before `main`.
#[cfg(windows)]
fn copy_windivert_sidecars() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let windivert_dir = manifest_dir.join("resources").join("windivert");
    println!("cargo:rerun-if-changed=resources/windivert/WinDivert.dll");
    println!("cargo:rerun-if-changed=resources/windivert/WinDivert64.sys");
    let Some(dir) = profile_output_dir() else {
        panic!("could not locate debug/release dir to copy WinDivert sidecars");
    };
    for name in ["WinDivert.dll", "WinDivert64.sys"] {
        let src = windivert_dir.join(name);
        let dest = dir.join(name);
        if !src.is_file() {
            panic!("missing {name} under resources/windivert");
        }
        if let Err(e) = fs::copy(&src, &dest) {
            if dest.is_file() {
                println!(
                    "cargo:warning=failed to refresh {name} next to horizon-gateway-serve ({e})"
                );
            } else {
                panic!("failed to copy {name} next to horizon-gateway-serve: {e}");
            }
        }
    }
}

fn profile_output_dir() -> Option<PathBuf> {
    let out_dir = env::var("OUT_DIR").ok()?;
    let mut dir = PathBuf::from(out_dir);
    for _ in 0..6 {
        let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "debug" || name == "release" {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
    None
}

fn embed_inspector_js() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let inspector = manifest_dir.join("resources").join("inspector.js");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let embed_rs = out_dir.join("inspector_js_embed.rs");

    println!("cargo:rerun-if-changed=resources/inspector.js");

    if inspector.is_file() {
        let dest_js = out_dir.join("inspector.js");
        fs::copy(&inspector, &dest_js).expect("failed to copy inspector.js into OUT_DIR");
        fs::write(
            &embed_rs,
            r#"pub const EMBEDDED_INSPECTOR_JS: Option<&str> = Some(include_str!(concat!(env!("OUT_DIR"), "/inspector.js")));
"#,
        )
        .expect("failed to write inspector_js_embed.rs");
    } else {
        fs::write(
            &embed_rs,
            r#"pub const EMBEDDED_INSPECTOR_JS: Option<&str> = None;
"#,
        )
        .expect("failed to write inspector_js_embed.rs");
    }
}

#[cfg(windows)]
fn embed_admin_manifest() {
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    println!("cargo:rerun-if-changed=windows-app-manifest.rc");
    println!("cargo:rerun-if-changed=windows-app-manifest-debug.xml");
    println!("cargo:rerun-if-changed=windows-app-manifest-debug.rc");
    // Release: requireAdministrator. Debug / `tauri dev`: asInvoker so leftovers
    // can be killed without UAC and cannot pin 8888 at a higher integrity level.
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let rc = if profile == "release" {
        "windows-app-manifest.rc"
    } else {
        "windows-app-manifest-debug.rc"
    };
    embed_resource::compile_for(rc, &["horizon-gateway-serve"], embed_resource::NONE)
        .manifest_required()
        .expect("failed to embed Windows admin manifest for horizon-gateway-serve");
}
