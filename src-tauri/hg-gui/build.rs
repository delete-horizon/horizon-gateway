use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    sync_skill_md_resource();
    // Dev (`tauri dev`) must not write sidecars into watched `resources/`.
    remove_debug_resource_sidecars();
    #[cfg(windows)]
    copy_windivert_sidecars();
    copy_sidecar_next_to_exe("horizon-gateway-serve");
    copy_sidecar_next_to_exe("hgc");
    println!("cargo:rerun-if-changed=binaries");
    patch_bundle_resources();
    build_tauri();
}

fn build_tauri() {
    #[cfg(windows)]
    {
        let windows = tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows-app-manifest.xml"));
        if let Err(e) =
            tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        {
            let msg = e.to_string();
            // Locked sidecar copies only. Do not ignore missing-resource errors:
            // try_build embeds the Common Controls v6 manifest *after* resource
            // copy, and skipping that yields STATUS_ENTRYPOINT_NOT_FOUND.
            if msg.contains("os error 32") || msg.contains("os error 33") {
                println!("cargo:warning=tauri build script sidecar warning: {msg}");
                embed_windows_manifest();
            } else {
                panic!("failed to run tauri build script: {msg}");
            }
        }
    }
    #[cfg(not(windows))]
    {
        tauri_build::build();
    }
}

/// RFC 7396-style merge that *keeps* JSON nulls so tauri-build can delete keys.
fn json_merge_keep_nulls(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let serde_json::Value::Object(patch_map) = patch {
        if !base.is_object() {
            *base = serde_json::json!({});
        }
        let serde_json::Value::Object(base_map) = base else {
            return;
        };
        for (key, val) in patch_map {
            if val.is_null() {
                base_map.insert(key.clone(), serde_json::Value::Null);
            } else {
                json_merge_keep_nulls(
                    base_map
                        .entry(key.clone())
                        .or_insert(serde_json::Value::Null),
                    val,
                );
            }
        }
    } else {
        *base = patch.clone();
    }
}

/// Drop bundle entries that would fail tauri-build on this platform/profile.
/// Sidecars are `externalBin` (`binaries/<name>-<triple>`); `WinDivert` is Windows-only.
fn patch_bundle_resources() {
    let mut bundle = serde_json::Map::new();

    if !is_release_profile() {
        bundle.insert("externalBin".into(), serde_json::Value::Null);
    }
    if cfg!(not(windows)) || !is_release_profile() {
        let mut resources = serde_json::Map::new();
        for key in [
            "resources/windivert/WinDivert.dll",
            "resources/windivert/WinDivert64.sys",
        ] {
            resources.insert(key.to_string(), serde_json::Value::Null);
        }
        bundle.insert("resources".into(), serde_json::Value::Object(resources));
    }
    if bundle.is_empty() {
        return;
    }

    let patch = serde_json::json!({ "bundle": bundle });
    let mut merged = env::var("TAURI_CONFIG")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    json_merge_keep_nulls(&mut merged, &patch);
    env::set_var("TAURI_CONFIG", merged.to_string());
}

#[cfg(not(windows))]
fn copy_windivert_sidecars() {}

fn sidecar_resource_names(bin_name: &str) -> [String; 2] {
    [format!("{bin_name}.exe"), bin_name.to_string()]
}

/// Leftover copies in watched `resources/` retrigger `tauri dev` rebuilds on Windows.
fn remove_debug_resource_sidecars() {
    if is_release_profile() {
        return;
    }
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let resources = manifest_dir.join("resources");
    for bin_name in ["horizon-gateway-serve", "hgc"] {
        for name in sidecar_resource_names(bin_name) {
            let path = resources.join(name);
            if path.is_file() {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

#[cfg(windows)]
fn embed_windows_manifest() {
    let mut res = winres::WindowsResource::new();
    res.set_manifest(include_str!("windows-app-manifest.xml"));
    if let Err(e) = res.compile() {
        println!("cargo:warning=failed to embed Windows app manifest: {e}");
    }
}

fn is_release_profile() -> bool {
    env::var("PROFILE").unwrap_or_else(|_| "debug".into()) == "release"
}

fn profile_target_dir(manifest_dir: &Path) -> PathBuf {
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let target_root = env::var("CARGO_TARGET_DIR")
        .map_or_else(|_| manifest_dir.join("..").join("target"), PathBuf::from);
    if let Ok(triple) = env::var("TARGET") {
        let triple_dir = target_root.join(&triple).join(&profile);
        if triple_dir.is_dir() {
            return triple_dir;
        }
    }
    target_root.join(profile)
}

fn same_path(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

fn copy_skipping_lock(src: &Path, dest: &Path, label: &str) {
    if same_path(src, dest) {
        return;
    }
    if let (Ok(src_meta), Ok(dest_meta)) = (src.metadata(), dest.metadata()) {
        if src_meta.len() == dest_meta.len()
            && src_meta.modified().ok() == dest_meta.modified().ok()
        {
            return;
        }
    }
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Err(e) = fs::copy(src, dest) {
        let locked = e.raw_os_error() == Some(32) || e.raw_os_error() == Some(33);
        if locked {
            println!(
                "cargo:warning=skipped copying {label} (file locked — stop horizon-gateway-serve to refresh)"
            );
        } else {
            println!("cargo:warning=failed to copy {label}: {e}");
        }
    }
}

fn copy_sidecar_next_to_exe(bin_name: &str) {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let Some(src) = find_sidecar_binary(&manifest_dir, bin_name) else {
        println!(
            "cargo:warning={bin_name} not found; run `node scripts/build-serve-sidecar.mjs` or `cargo build -p {bin_name}`"
        );
        return;
    };

    let ext = if cfg!(windows) { ".exe" } else { "" };
    let dest = profile_target_dir(&manifest_dir).join(format!("{bin_name}{ext}"));
    copy_skipping_lock(&src, &dest, &format!("{bin_name} next to GUI exe"));
}

fn find_sidecar_binary(manifest_dir: &Path, bin_name: &str) -> Option<PathBuf> {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let file_name = format!("{bin_name}{ext}");
    let mut candidates = Vec::new();

    if let Ok(target) = env::var("TARGET") {
        candidates.push(
            manifest_dir
                .join("binaries")
                .join(format!("{bin_name}-{target}{ext}")),
        );
    }

    candidates.push(profile_target_dir(manifest_dir).join(&file_name));

    candidates
        .into_iter()
        .find(|path| path.is_file() && path.metadata().map(|m| m.len() > 0).unwrap_or(false))
}

/// Automatically sync project master SKILL.md (`.agents/skills/horizon-gateway/SKILL.md`)
/// to embedded resources (`resources/skills/horizon-gateway/SKILL.md`) at build time.
fn sync_skill_md_resource() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source_skill = manifest_dir
        .join("..")
        .join("..")
        .join(".agents")
        .join("skills")
        .join("horizon-gateway")
        .join("SKILL.md");
    let dest_skill = manifest_dir
        .join("resources")
        .join("skills")
        .join("horizon-gateway")
        .join("SKILL.md");

    println!("cargo:rerun-if-changed={}", source_skill.display());

    if source_skill.is_file() {
        if dest_skill.is_file() {
            let src_bytes = fs::read(&source_skill).ok();
            let dest_bytes = fs::read(&dest_skill).ok();
            if src_bytes.is_some() && src_bytes == dest_bytes {
                return;
            }
        }
        if let Some(parent) = dest_skill.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::copy(&source_skill, &dest_skill);
    }
}

/// Place `WinDivert` sidecar files next to the built exe so `cargo run` / local builds work.
/// Installers also bundle these via `tauri.conf.json` resources + NSIS post-install copy.
#[cfg(windows)]
fn copy_windivert_sidecars() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let windivert_dir = manifest_dir.join("resources").join("windivert");
    println!("cargo:rerun-if-changed=resources/windivert/WinDivert.dll");
    println!("cargo:rerun-if-changed=resources/windivert/WinDivert64.sys");

    let target_dir = profile_target_dir(&manifest_dir);

    let icon = manifest_dir.join("icons").join("icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    if icon.is_file() {
        copy_skipping_lock(&icon, &target_dir.join("icon.ico"), "icon.ico");
    }

    for name in ["WinDivert.dll", "WinDivert64.sys"] {
        let src = windivert_dir.join(name);
        if !src.is_file() {
            println!(
                "cargo:warning=missing {name} under resources/windivert — transparent proxy will fail"
            );
            continue;
        }
        copy_skipping_lock(&src, &target_dir.join(name), name);
    }
}
