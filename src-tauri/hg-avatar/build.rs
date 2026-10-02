use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dir = manifest_dir.join("..").join("..").join("avatar-parts");
    println!("cargo:rerun-if-changed={}", dir.display());

    let sets_path = dir.join("sets.json");
    println!("cargo:rerun-if-changed={}", sets_path.display());
    let sets = if sets_path.is_file() {
        let sets_val: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&sets_path).unwrap_or_else(|e| panic!("sets.json: {e}")),
        )
        .unwrap_or_else(|e| panic!("sets.json: {e}"));
        sets_val
            .get("sets")
            .cloned()
            .unwrap_or(serde_json::json!([]))
    } else {
        serde_json::json!([])
    };

    let groups_path = dir.join("groups.json");
    println!("cargo:rerun-if-changed={}", groups_path.display());
    let groups = if groups_path.is_file() {
        let groups_val: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&groups_path).unwrap_or_else(|e| panic!("groups.json: {e}")),
        )
        .unwrap_or_else(|e| panic!("groups.json: {e}"));
        groups_val
            .get("groups")
            .cloned()
            .unwrap_or(serde_json::json!([]))
    } else {
        serde_json::json!([])
    };

    let actions_path = dir.join("held-actions.json");
    println!("cargo:rerun-if-changed={}", actions_path.display());
    let held_actions = if actions_path.is_file() {
        let actions_val: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&actions_path).unwrap_or_else(|e| panic!("held-actions.json: {e}")),
        )
        .unwrap_or_else(|e| panic!("held-actions.json: {e}"));
        actions_val
            .get("actions")
            .cloned()
            .unwrap_or(serde_json::json!([]))
    } else {
        serde_json::json!([])
    };

    let mut parts = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for ent in entries {
        let path = ent.path();
        println!("cargo:rerun-if-changed={}", path.display());
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name == "sets.json" || name == "groups.json" || name == "held-actions.json" {
            continue;
        }
        let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let value: serde_json::Value =
            serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        parts.push(value);
    }

    let packed = serde_json::json!({
        "parts": parts,
        "sets": sets,
        "groups": groups,
        "heldActions": held_actions,
        "warnings": []
    });
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("avatar_catalog.json");
    fs::write(&out, serde_json::to_string(&packed).unwrap())
        .unwrap_or_else(|e| panic!("write {}: {e}", out.display()));
}
