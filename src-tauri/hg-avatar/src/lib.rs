//! Layered pixel-art avatar. Part SKUs live in `avatar-parts/*.json`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use specta::Type;
use tiny_skia::{Paint, Pixmap, Rect, Transform};

pub const GRID: i32 = 24;
/// Extra rows above the glyph grid so perch hats can sit on the crown.
pub const PAD_TOP: i32 = 4;
pub const COMPOSE_H: i32 = GRID + PAD_TOP;
/// Screen pixels per glyph cell for a body with `scale` 1.0 (human).
pub const PIXEL_SIZE: f32 = 4.0;
/// Smallest cell size we still present (tiny races like imp).
pub const MIN_PIXEL_SIZE: f32 = 1.0;
const GLYPH_OK: &str = ".OSDCKAMEW";
const SLOTS: &[&str] = &["body", "head", "outfit", "back", "held"];
const DEFAULT_GROUP: &str = "humanoid";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarRig {
    pub crown: [i32; 2],
    pub face: [i32; 2],
    pub torso: [i32; 2],
    pub hand: [i32; 2],
    /// Column and row of the pelvis. Pixels below this row step during a walk.
    #[serde(default = "human_hip")]
    pub hip: [i32; 2],
    /// Inboard of `hand`. Held parts swing from this joint.
    #[serde(default = "human_shoulder")]
    pub shoulder: [i32; 2],
}

fn human_hip() -> [i32; 2] {
    [12, 17]
}

fn human_shoulder() -> [i32; 2] {
    [15, 14]
}

impl AvatarRig {
    const HUMAN: Self = Self {
        crown: [12, 3],
        face: [12, 7],
        torso: [12, 14],
        hand: [16, 15],
        hip: [12, 17],
        shoulder: [15, 14],
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HeadAttach {
    /// Brim / seat maps onto body crown (wizard hat, crown).
    Perch,
    /// Aligns with face box (hood, helm, mask).
    Cover,
    /// Same offset as outfit (legacy absolute art).
    Flat,
}

impl HeadAttach {
    fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "perch" => Self::Perch,
            "cover" => Self::Cover,
            _ => Self::Flat,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarGroup {
    pub id: String,
    #[serde(default = "default_group_grid")]
    pub grid: u32,
    #[serde(default)]
    pub reference_body: String,
    #[serde(default)]
    pub ko: String,
    #[serde(default)]
    pub en: String,
}

fn default_group_grid() -> u32 {
    GRID as u32
}

fn default_scale() -> f32 {
    1.0
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarKit {
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub head: String,
    #[serde(default)]
    pub outfit: String,
    #[serde(default)]
    pub back: String,
    #[serde(default)]
    pub held: String,
}

impl AvatarKit {
    pub fn normalized(&self) -> Self {
        let cat = current_catalog();
        Self {
            body: cat.canon("body", &self.body, "sprite"),
            head: cat.canon("head", &self.head, "none"),
            outfit: cat.canon("outfit", &self.outfit, "cloak"),
            back: cat.canon("back", &self.back, "none"),
            held: cat.canon("held", &self.held, "staff"),
        }
    }

    pub fn ids(&self) -> AvatarIds {
        let n = self.normalized();
        let cat = current_catalog();
        AvatarIds {
            body: cat.idx("body", &n.body),
            head: cat.idx("head", &n.head),
            outfit: cat.idx("outfit", &n.outfit),
            back: cat.idx("back", &n.back),
            held: cat.idx("held", &n.held),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AvatarIds {
    pub body: u8,
    pub head: u8,
    pub outfit: u8,
    pub back: u8,
    pub held: u8,
}

impl AvatarIds {
    pub fn kit(self) -> AvatarKit {
        let cat = current_catalog();
        AvatarKit {
            body: cat.pick("body", self.body, "sprite"),
            head: cat.pick("head", self.head, "none"),
            outfit: cat.pick("outfit", self.outfit, "cloak"),
            back: cat.pick("back", self.back, "none"),
            held: cat.pick("held", self.held, "staff"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarStudioPart {
    pub id: String,
    pub slot: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub set: String,
    #[serde(default)]
    pub shop: bool,
    pub ko: String,
    pub en: String,
    pub glyphs: Vec<String>,
    /// Silhouette group this body belongs to (body slot). Skins use `fits`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub group: String,
    /// Display scale within the group (body slot). 1.0 = reference height.
    #[serde(default = "default_scale")]
    pub scale: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rig: Option<AvatarRig>,
    /// head: `perch` | `cover` | empty (flat)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub attach: String,
    /// head perch seat (brim center). If omitted, inferred from bottom pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat: Option<[i32; 2]>,
    /// Which silhouette groups may wear this skin. Empty = any same-grid group.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fits: Vec<String>,
    /// Per-part colors. Missing channels fall back to the shared default chroma.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chroma: Option<PartChroma>,
    /// Held slot only. Id in `held-actions.json`. Empty on other slots.
    /// New kinds are a new row in that file; parts only store the id.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub weapon_kind: String,
}

/// Optional RGB overrides for glyph channels. Body should set `skin` / `skinD`;
/// outfits and gear set cloth / metal / accent. Agents fill distinctive values later.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PartChroma {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skin: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skin_d: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloth: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloth_d: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metal: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eye: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub white: Option<[u8; 3]>,
}

impl PartChroma {
    /// Shared baseline (matches former `dusk` palette). Parts start here.
    pub const DEFAULT: Self = Self {
        outline: Some([28, 18, 44]),
        skin: Some([232, 196, 168]),
        skin_d: Some([180, 132, 112]),
        cloth: Some([88, 64, 148]),
        cloth_d: Some([48, 32, 92]),
        accent: Some([180, 140, 255]),
        metal: Some([188, 176, 220]),
        eye: Some([28, 22, 40]),
        white: Some([250, 246, 255]),
    };

    fn merge_over(&self, base: &Palette) -> Palette {
        Palette {
            outline: self.outline.unwrap_or(base.outline),
            skin: self.skin.unwrap_or(base.skin),
            skin_d: self.skin_d.unwrap_or(base.skin_d),
            cloth: self.cloth.unwrap_or(base.cloth),
            cloth_d: self.cloth_d.unwrap_or(base.cloth_d),
            accent: self.accent.unwrap_or(base.accent),
            metal: self.metal.unwrap_or(base.metal),
            eye: self.eye.unwrap_or(base.eye),
            white: self.white.unwrap_or(base.white),
        }
    }
}

fn default_chroma_palette() -> Palette {
    PartChroma::DEFAULT.merge_over(&Palette {
        outline: [28, 18, 44],
        skin: [232, 196, 168],
        skin_d: [180, 132, 112],
        cloth: [88, 64, 148],
        cloth_d: [48, 32, 92],
        accent: [180, 140, 255],
        metal: [188, 176, 220],
        eye: [28, 22, 40],
        white: [250, 246, 255],
    })
}

fn layer_palette(cat: &Catalog, part: &AvatarStudioPart) -> Palette {
    // default → set chroma → part chroma (part wins per channel)
    let mut pal = default_chroma_palette();
    if !part.set.trim().is_empty() {
        if let Some(set) = cat.sets.iter().find(|s| s.id == part.set) {
            if let Some(c) = &set.chroma {
                pal = c.merge_over(&pal);
            }
        }
    }
    if let Some(c) = &part.chroma {
        pal = c.merge_over(&pal);
    }
    pal
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarStudioCatalog {
    pub parts: Vec<AvatarStudioPart>,
    #[serde(default)]
    pub sets: Vec<AvatarStudioSet>,
    #[serde(default)]
    pub groups: Vec<AvatarGroup>,
    /// Unified held actions. A new weapon kind is a row here, not a new part handler.
    #[serde(default)]
    pub held_actions: Vec<HeldAction>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// One action shared by every held part of this kind.
/// `overlay` is the existing comm effect. A later kind points at an effect until it has its own.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HeldAction {
    pub id: String,
    /// `weapon`, `prop`, or `unarmed`.
    pub role: String,
    pub ko: String,
    pub en: String,
    pub overlay: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarStudioSet {
    pub id: String,
    pub ko: String,
    pub en: String,
    #[serde(default)]
    pub shop: bool,
    #[serde(default)]
    pub kit: AvatarKit,
    /// Shared colors for parts tagged `"set": "<id>"`. Part `chroma` overrides per channel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chroma: Option<PartChroma>,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarPreview {
    pub width: u32,
    pub height: u32,
    pub rgba_base64: String,
}

#[derive(Deserialize)]
struct SetsFile {
    #[serde(default)]
    sets: Vec<AvatarStudioSet>,
}

#[derive(Deserialize)]
struct GroupsFile {
    #[serde(default)]
    groups: Vec<AvatarGroup>,
}

#[derive(Deserialize)]
struct HeldActionsFile {
    #[serde(default)]
    actions: Vec<HeldAction>,
}

#[derive(Clone, Copy)]
struct Palette {
    outline: [u8; 3],
    skin: [u8; 3],
    skin_d: [u8; 3],
    cloth: [u8; 3],
    cloth_d: [u8; 3],
    accent: [u8; 3],
    metal: [u8; 3],
    eye: [u8; 3],
    white: [u8; 3],
}

#[derive(Clone, Copy)]
enum Ch {
    Outline,
    Skin,
    SkinD,
    Cloth,
    ClothD,
    Accent,
    Metal,
    Eye,
    White,
}

fn rgb(pal: &Palette, ch: Ch) -> [u8; 3] {
    match ch {
        Ch::Outline => pal.outline,
        Ch::Skin => pal.skin,
        Ch::SkinD => pal.skin_d,
        Ch::Cloth => pal.cloth,
        Ch::ClothD => pal.cloth_d,
        Ch::Accent => pal.accent,
        Ch::Metal => pal.metal,
        Ch::Eye => pal.eye,
        Ch::White => pal.white,
    }
}

fn channel(c: char) -> Option<Ch> {
    match c {
        'O' => Some(Ch::Outline),
        'S' => Some(Ch::Skin),
        'D' => Some(Ch::SkinD),
        'C' => Some(Ch::Cloth),
        'K' => Some(Ch::ClothD),
        'A' => Some(Ch::Accent),
        'M' => Some(Ch::Metal),
        'E' => Some(Ch::Eye),
        'W' => Some(Ch::White),
        _ => None,
    }
}

#[derive(Clone)]
struct Catalog {
    parts: Vec<AvatarStudioPart>,
    sets: Vec<AvatarStudioSet>,
    groups: Vec<AvatarGroup>,
    held_actions: Vec<HeldAction>,
    warnings: Vec<String>,
    body_ids: Vec<String>,
    head_ids: Vec<String>,
    outfit_ids: Vec<String>,
    back_ids: Vec<String>,
    held_ids: Vec<String>,
}

impl Catalog {
    fn from_dto(mut dto: AvatarStudioCatalog) -> Result<Self, String> {
        let mut seen = std::collections::BTreeSet::new();
        for part in &dto.parts {
            validate_part(part)?;
            let key = format!("{}:{}", part.slot, part.id);
            if !seen.insert(key) {
                return Err(format!("duplicate part {}:{}", part.slot, part.id));
            }
        }
        dto.parts.sort_by(|a, b| {
            a.set
                .cmp(&b.set)
                .then_with(|| slot_rank(&a.slot).cmp(&slot_rank(&b.slot)))
                .then_with(|| a.id.cmp(&b.id))
        });
        let body_ids = ids_in(&dto.parts, "body");
        if body_ids.is_empty() {
            return Err("need at least one body part".into());
        }
        let mut warnings = dto.warnings;
        let mut action_ids = std::collections::BTreeSet::new();
        for action in &dto.held_actions {
            let id = action.id.trim();
            if id.is_empty() || action.overlay.trim().is_empty() {
                return Err(format!("held action '{id}' needs an id and an overlay"));
            }
            if !action_ids.insert(id.to_string()) {
                return Err(format!("duplicate held action '{id}'"));
            }
        }
        for part in &dto.parts {
            if part.slot != "held" {
                continue;
            }
            let kind = part.weapon_kind.trim();
            if kind.is_empty() {
                warnings.push(format!("held {}: missing weaponKind", part.id));
            } else if !action_ids.contains(kind) {
                warnings.push(format!(
                    "held {}: unknown weaponKind '{kind}'",
                    part.id
                ));
            }
        }
        for set in &dto.sets {
            validate_id(&set.id)?;
            for (slot, id) in [
                ("body", set.kit.body.as_str()),
                ("head", set.kit.head.as_str()),
                ("outfit", set.kit.outfit.as_str()),
                ("back", set.kit.back.as_str()),
                ("held", set.kit.held.as_str()),
            ] {
                if id.is_empty() || id == "none" {
                    continue;
                }
                let exists = dto.parts.iter().any(|p| p.slot == slot && p.id == id);
                if !exists {
                    warnings.push(format!("set {}: unknown {slot} id '{id}'", set.id));
                }
            }
        }
        Ok(Self {
            body_ids,
            head_ids: with_none(ids_in(&dto.parts, "head")),
            outfit_ids: with_none(ids_in(&dto.parts, "outfit")),
            back_ids: with_none(ids_in(&dto.parts, "back")),
            held_ids: with_none(ids_in(&dto.parts, "held")),
            parts: dto.parts,
            sets: dto.sets,
            groups: if dto.groups.is_empty() {
                vec![AvatarGroup {
                    id: DEFAULT_GROUP.into(),
                    grid: GRID as u32,
                    reference_body: "human".into(),
                    ko: "인간형".into(),
                    en: "Humanoid".into(),
                }]
            } else {
                dto.groups
            },
            held_actions: dto.held_actions,
            warnings,
        })
    }

    fn ids(&self, slot: &str) -> &[String] {
        match slot {
            "body" => &self.body_ids,
            "head" => &self.head_ids,
            "outfit" => &self.outfit_ids,
            "back" => &self.back_ids,
            "held" => &self.held_ids,
            _ => &[],
        }
    }

    fn canon(&self, slot: &str, raw: &str, fallback: &str) -> String {
        let allowed = self.ids(slot);
        let t = raw.trim().to_ascii_lowercase();
        if t.is_empty() || t == "default" {
            return prefer(allowed, fallback);
        }
        if allowed.iter().any(|v| v == &t) {
            t
        } else {
            prefer(allowed, fallback)
        }
    }

    fn idx(&self, slot: &str, id: &str) -> u8 {
        self.ids(slot).iter().position(|v| v == id).unwrap_or(0) as u8
    }

    fn pick(&self, slot: &str, i: u8, fallback: &str) -> String {
        let allowed = self.ids(slot);
        allowed
            .get(i as usize)
            .cloned()
            .unwrap_or_else(|| prefer(allowed, fallback))
    }

    fn part(&self, slot: &str, id: &str) -> Option<&AvatarStudioPart> {
        if id == "none" {
            return None;
        }
        self.parts.iter().find(|p| p.slot == slot && p.id == id)
    }

    fn dto(&self) -> AvatarStudioCatalog {
        let hidden: std::collections::HashSet<(String, String)> = runtime_store()
            .read()
            .iter()
            .map(|part| (part.slot.clone(), part.id.clone()))
            .collect();
        AvatarStudioCatalog {
            parts: self
                .parts
                .iter()
                .filter(|part| !hidden.contains(&(part.slot.clone(), part.id.clone())))
                .cloned()
                .collect(),
            sets: self.sets.clone(),
            groups: self.groups.clone(),
            held_actions: self.held_actions.clone(),
            warnings: self.warnings.clone(),
        }
    }

    fn body_meta(&self, body_id: &str) -> (String, f32, AvatarRig) {
        let Some(p) = self.part("body", body_id) else {
            return (DEFAULT_GROUP.into(), 1.0, AvatarRig::HUMAN);
        };
        let group = if p.group.trim().is_empty() {
            DEFAULT_GROUP.to_string()
        } else {
            p.group.clone()
        };
        let scale = if p.scale.is_finite() && p.scale > 0.0 {
            p.scale.clamp(0.5, 2.0)
        } else {
            1.0
        };
        let rig = p.rig.unwrap_or(AvatarRig::HUMAN);
        (group, scale, rig)
    }

    fn ref_rig(&self, group_id: &str) -> AvatarRig {
        let ref_body = self
            .groups
            .iter()
            .find(|g| g.id == group_id)
            .map(|g| g.reference_body.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("human");
        self.part("body", ref_body)
            .and_then(|p| p.rig)
            .unwrap_or(AvatarRig::HUMAN)
    }
}

fn slot_rank(slot: &str) -> u8 {
    match slot {
        "body" => 0,
        "head" => 1,
        "outfit" => 2,
        "back" => 3,
        "held" => 4,
        _ => 9,
    }
}

fn prefer(allowed: &[String], fallback: &str) -> String {
    if allowed.iter().any(|v| v == fallback) {
        fallback.to_string()
    } else {
        allowed
            .first()
            .cloned()
            .unwrap_or_else(|| fallback.to_string())
    }
}

fn with_none(mut ids: Vec<String>) -> Vec<String> {
    ids.insert(0, "none".into());
    ids
}

fn ids_in(parts: &[AvatarStudioPart], slot: &str) -> Vec<String> {
    parts
        .iter()
        .filter(|p| p.slot == slot)
        .map(|p| p.id.clone())
        .collect()
}

fn validate_id(id: &str) -> Result<(), String> {
    let b = id.as_bytes();
    if !(1..=32).contains(&b.len())
        || !b[0].is_ascii_lowercase()
        || !b
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
    {
        return Err(format!(
            "bad id '{id}' (use kebab-case [a-z][a-z0-9-]{{0,31}})"
        ));
    }
    if id == "none" || id == "default" {
        return Err(format!("'{id}' is reserved"));
    }
    Ok(())
}

pub fn validate_part(part: &AvatarStudioPart) -> Result<(), String> {
    validate_id(&part.id)?;
    if !SLOTS.contains(&part.slot.as_str()) {
        return Err(format!("bad slot '{}' on {}", part.slot, part.id));
    }
    if part.glyphs.len() != GRID as usize {
        return Err(format!(
            "{}:{} needs {GRID} glyph rows, got {}",
            part.slot,
            part.id,
            part.glyphs.len()
        ));
    }
    for (i, row) in part.glyphs.iter().enumerate() {
        if row.chars().count() != GRID as usize {
            return Err(format!(
                "{}:{} row {i} must be {GRID} chars, got {}",
                part.slot,
                part.id,
                row.chars().count()
            ));
        }
        if let Some(bad) = row.chars().find(|c| !GLYPH_OK.contains(*c)) {
            return Err(format!(
                "{}:{} row {i} has '{bad}' — only {GLYPH_OK}",
                part.slot, part.id
            ));
        }
    }
    Ok(())
}

fn store() -> &'static RwLock<Arc<Catalog>> {
    static CELL: OnceCell<RwLock<Arc<Catalog>>> = OnceCell::new();
    CELL.get_or_init(|| RwLock::new(Arc::new(load_initial())))
}

fn current_catalog() -> Arc<Catalog> {
    store().read().clone()
}

fn load_initial() -> Catalog {
    load_best().unwrap_or_else(|e| panic!("avatar catalog: {e}"))
}

fn load_best() -> Result<Catalog, String> {
    if let Some(dir) = find_parts_dir() {
        return load_from_dir(&dir);
    }
    parse_packed(include_str!(concat!(
        env!("OUT_DIR"),
        "/avatar_catalog.json"
    )))
}

fn parse_packed(raw: &str) -> Result<Catalog, String> {
    let dto: AvatarStudioCatalog =
        serde_json::from_str(raw).map_err(|e| format!("packed catalog: {e}"))?;
    Catalog::from_dto(dto)
}

fn load_from_dir(dir: &Path) -> Result<Catalog, String> {
    let sets_path = dir.join("sets.json");
    let sets = if sets_path.is_file() {
        let file: SetsFile = serde_json::from_str(
            &std::fs::read_to_string(&sets_path)
                .map_err(|e| format!("{}: {e}", sets_path.display()))?,
        )
        .map_err(|e| format!("sets.json: {e}"))?;
        file.sets
    } else {
        Vec::new()
    };
    let groups_path = dir.join("groups.json");
    let groups = if groups_path.is_file() {
        let file: GroupsFile = serde_json::from_str(
            &std::fs::read_to_string(&groups_path)
                .map_err(|e| format!("{}: {e}", groups_path.display()))?,
        )
        .map_err(|e| format!("groups.json: {e}"))?;
        file.groups
    } else {
        Vec::new()
    };
    let actions_path = dir.join("held-actions.json");
    let held_actions = if actions_path.is_file() {
        let file: HeldActionsFile = serde_json::from_str(
            &std::fs::read_to_string(&actions_path)
                .map_err(|e| format!("{}: {e}", actions_path.display()))?,
        )
        .map_err(|e| format!("held-actions.json: {e}"))?;
        file.actions
    } else {
        Vec::new()
    };
    let mut parts = Vec::new();
    let mut warnings = Vec::new();
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect();
    files.sort();
    for path in files {
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name == "sets.json" || name == "groups.json" || name == "held-actions.json" {
            continue;
        }
        match load_part_file(&path) {
            Ok(part) => {
                let expected = format!("{}-{}.json", part.slot, part.id);
                if name != expected {
                    warnings.push(format!("{name}: expected {expected}"));
                }
                parts.push(part);
            }
            Err(e) => warnings.push(e),
        }
    }
    Catalog::from_dto(AvatarStudioCatalog {
        parts,
        sets,
        groups,
        held_actions,
        warnings,
    })
}

fn load_part_file(path: &Path) -> Result<AvatarStudioPart, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))
}

fn find_parts_dir() -> Option<PathBuf> {
    let mut cands = Vec::new();
    if let Ok(p) = std::env::var("HG_AVATAR_PARTS") {
        cands.push(PathBuf::from(p));
    }
    cands.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../avatar-parts"));
    if let Ok(cwd) = std::env::current_dir() {
        let mut cur = cwd;
        for _ in 0..8 {
            cands.push(cur.join("avatar-parts"));
            if !cur.pop() {
                break;
            }
        }
    }
    if let Ok(mut exe) = std::env::current_exe() {
        for _ in 0..8 {
            exe.pop();
            cands.push(exe.join("avatar-parts"));
        }
    }
    cands.into_iter().find(|p| p.join("sets.json").is_file())
}

pub fn apply_set(base: &AvatarKit, set_id: &str) -> AvatarKit {
    let cat = current_catalog();
    let Some(set) = cat.sets.iter().find(|s| s.id == set_id) else {
        return base.normalized();
    };
    let keep = |cur: &str, next: &str| {
        if next.trim().is_empty() {
            cur.to_string()
        } else {
            next.to_string()
        }
    };
    AvatarKit {
        body: keep(&base.body, &set.kit.body),
        head: keep(&base.head, &set.kit.head),
        outfit: keep(&base.outfit, &set.kit.outfit),
        back: keep(&base.back, &set.kit.back),
        held: keep(&base.held, &set.kit.held),
    }
    .normalized()
}

fn runtime_store() -> &'static RwLock<Vec<AvatarStudioPart>> {
    static CELL: OnceCell<RwLock<Vec<AvatarStudioPart>>> = OnceCell::new();
    CELL.get_or_init(|| RwLock::new(Vec::new()))
}

fn merge_runtime(mut base: Catalog) -> Catalog {
    let extra = runtime_store().read().clone();
    for part in extra {
        base.parts
            .retain(|kept| !(kept.slot == part.slot && kept.id == part.id));
        base.parts.push(part);
    }
    base.body_ids = ids_in(&base.parts, "body");
    base.head_ids = with_none(ids_in(&base.parts, "head"));
    base.outfit_ids = with_none(ids_in(&base.parts, "outfit"));
    base.back_ids = with_none(ids_in(&base.parts, "back"));
    base.held_ids = with_none(ids_in(&base.parts, "held"));
    base
}

fn validate_runtime_part(part: &AvatarStudioPart) -> Result<(), String> {
    let id = part.id.trim();
    if id.is_empty() || id.len() > 64 || !SLOTS.contains(&part.slot.as_str()) {
        return Err(format!("bad runtime part {}:{}", part.slot, part.id));
    }
    if part.glyphs.len() != GRID as usize {
        return Err(format!(
            "{}:{} needs {GRID} glyph rows, got {}",
            part.slot,
            part.id,
            part.glyphs.len()
        ));
    }
    for (i, row) in part.glyphs.iter().enumerate() {
        if row.chars().count() != GRID as usize {
            return Err(format!(
                "{}:{} row {i} must be {GRID} chars, got {}",
                part.slot,
                part.id,
                row.chars().count()
            ));
        }
        if let Some(bad) = row.chars().find(|c| !GLYPH_OK.contains(*c)) {
            return Err(format!(
                "{}:{} row {i} has '{bad}' — only {GLYPH_OK}",
                part.slot, part.id
            ));
        }
    }
    Ok(())
}

/// Teammate parts that are not in the on-disk catalog. Compose can see them; catalog DTO does not.
pub fn install_runtime_parts(incoming: Vec<AvatarStudioPart>) -> Result<(), String> {
    {
        let mut extra = runtime_store().write();
        for part in incoming {
            validate_runtime_part(&part)?;
            let mut part = part;
            part.id = part.id.trim().to_ascii_lowercase();
            extra.retain(|kept| !(kept.slot == part.slot && kept.id == part.id));
            extra.push(part);
        }
    }
    let base = load_best().unwrap_or_else(|_| (**store().read()).clone());
    *store().write() = Arc::new(merge_runtime(base));
    Ok(())
}

fn reset_runtime_parts() {
    runtime_store().write().clear();
    if let Ok(base) = load_best() {
        *store().write() = Arc::new(base);
    }
}

pub fn reload_from_disk() -> Result<AvatarStudioCatalog, String> {
    let merged = merge_runtime(load_best()?);
    let dto = merged.dto();
    *store().write() = Arc::new(merged);
    Ok(dto)
}

pub fn write_part(part: AvatarStudioPart) -> Result<String, String> {
    validate_part(&part)?;
    let dir = find_parts_dir().ok_or_else(|| {
        "avatar-parts folder not found. Run from the gateway repo, or set HG_AVATAR_PARTS."
            .to_string()
    })?;
    let file = dir.join(format!("{}-{}.json", part.slot, part.id));
    let json = serde_json::to_string_pretty(&part).map_err(|e| e.to_string())?;
    std::fs::write(&file, format!("{json}\n")).map_err(|e| format!("{}: {e}", file.display()))?;
    reload_from_disk()?;
    Ok(file.display().to_string())
}

pub fn preview_pngish(kit: &AvatarKit, step: u8) -> AvatarPreview {
    let buf = compose(kit, 255, step);
    AvatarPreview {
        width: GRID as u32,
        height: COMPOSE_H as u32,
        rgba_base64: STANDARD.encode(buf),
    }
}

struct GridBuf {
    w: i32,
    h: i32,
    px: Vec<u8>,
}

impl GridBuf {
    fn new(w: i32, h: i32) -> Self {
        Self {
            w,
            h,
            px: vec![0; (w * h * 4) as usize],
        }
    }

    fn put(&mut self, x: i32, y: i32, rgb: [u8; 3], a: u8) {
        if a == 0 || x < 0 || y < 0 || x >= self.w || y >= self.h {
            return;
        }
        let i = ((y * self.w + x) * 4) as usize;
        self.px[i] = rgb[0];
        self.px[i + 1] = rgb[1];
        self.px[i + 2] = rgb[2];
        self.px[i + 3] = a;
    }

    fn paint(&mut self, glyphs: &[String], pal: &Palette, a: u8, dx: i32, dy: i32) {
        self.paint_posed(glyphs, pal, a, dx, dy, None, (0, 0));
    }

    /// `shift` lifts one leg by a cell. `nudge` moves the whole layer (weapon grip).
    fn paint_posed(
        &mut self,
        glyphs: &[String],
        pal: &Palette,
        a: u8,
        dx: i32,
        dy: i32,
        shift: Option<LimbShift>,
        nudge: (i32, i32),
    ) {
        for (y, row) in glyphs.iter().enumerate() {
            for (x, c) in row.chars().enumerate() {
                let Some(ch) = channel(c) else {
                    continue;
                };
                let mut px = x as i32 + dx + nudge.0;
                let mut py = y as i32 + dy + nudge.1;
                if let Some(shift) = shift {
                    if !shift.lock && (shift.dy != 0 || shift.out != 0) && py > shift.hip_y {
                        let on_side = match shift.side.signum() {
                            1 => px > shift.hip_x,
                            -1 => px < shift.hip_x,
                            _ => false,
                        };
                        if on_side {
                            py += shift.dy;
                            px += shift.side.signum() * shift.out;
                        }
                    }
                }
                self.put(px, py, rgb(pal, ch), a);
            }
        }
    }

    fn opaque(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || x >= self.w || y >= self.h {
            return false;
        }
        let i = ((y * self.w + x) * 4) as usize;
        self.px.get(i + 3).copied().unwrap_or(0) > 0
    }

    /// Replace the face with a hurt or angry expression. Only opaque cells change,
    /// so a hood or helm keeps its silhouette.
    fn stamp_face(&mut self, fx: i32, fy: i32, pal: &Palette, a: u8, mood: FaceMood) {
        let mut solid = 0;
        for dy in -2..=2 {
            for dx in -3..=3 {
                if self.opaque(fx + dx, fy + dy) {
                    solid += 1;
                }
            }
        }
        if solid < 8 {
            return;
        }
        let skin = rgb(pal, Ch::Skin);
        let mark = rgb(pal, Ch::Outline);
        let eye = rgb(pal, Ch::Eye);
        let white = rgb(pal, Ch::White);
        for dy in -2..=2 {
            for dx in -3..=3 {
                let x = fx + dx;
                let y = fy + dy;
                if self.opaque(x, y) {
                    self.put(x, y, skin, a);
                }
            }
        }
        let mut dot = |dx: i32, dy: i32, color: [u8; 3]| {
            let x = fx + dx;
            let y = fy + dy;
            if self.opaque(x, y) {
                self.put(x, y, color, a);
            }
        };
        match mood {
            FaceMood::Hurt => {
                dot(-3, -1, mark);
                dot(-2, 0, mark);
                dot(-3, 1, mark);
                dot(-1, -1, mark);
                dot(-1, 1, mark);
                dot(3, -1, mark);
                dot(2, 0, mark);
                dot(3, 1, mark);
                dot(1, -1, mark);
                dot(1, 1, mark);
                dot(0, 0, mark);
                dot(-1, 2, mark);
                dot(0, 2, eye);
                dot(1, 2, mark);
            }
            FaceMood::Angry => {
                dot(-3, -2, mark);
                dot(-2, -1, mark);
                dot(3, -2, mark);
                dot(2, -1, mark);
                dot(-2, 0, white);
                dot(-1, 0, eye);
                dot(1, 0, eye);
                dot(2, 0, white);
                dot(-2, 1, mark);
                dot(2, 1, mark);
                dot(-1, 2, mark);
                dot(0, 2, mark);
                dot(1, 2, mark);
            }
            FaceMood::Neutral => {}
        }
    }
}

fn infer_seat(glyphs: &[String]) -> [i32; 2] {
    for y in (0..GRID).rev() {
        let Some(row) = glyphs.get(y as usize) else {
            continue;
        };
        let xs: Vec<i32> = row
            .chars()
            .enumerate()
            .filter(|(_, c)| *c != '.')
            .map(|(x, _)| x as i32)
            .collect();
        if let (Some(lo), Some(hi)) = (xs.first(), xs.last()) {
            return [(lo + hi) / 2, y];
        }
    }
    [GRID / 2, GRID / 4]
}

fn layer_ok_for_group(part: &AvatarStudioPart, group: &str) -> bool {
    if part.fits.is_empty() {
        return true;
    }
    part.fits.iter().any(|g| g == group || g == "*")
}

/// Display scale for the equipped body within its silhouette group.
pub fn body_scale(kit: &AvatarKit) -> f32 {
    let kit = kit.normalized();
    current_catalog().body_meta(&kit.body).1
}

/// Final overlay cell size for a kit (never drops below [`MIN_PIXEL_SIZE`]).
pub fn display_pixel_size(kit: &AvatarKit, resident_scale: f32) -> f32 {
    (PIXEL_SIZE * body_scale(kit) * resident_scale.max(0.8)).max(MIN_PIXEL_SIZE)
}

/// Face drawn over the rig while a resident is flinching.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaceMood {
    Neutral,
    /// Squeezed eyes and a small grimace.
    Hurt,
    /// Slanted brows, narrowed eyes, frown.
    Angry,
}

impl FaceMood {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Hurt,
            2 => Self::Angry,
            _ => Self::Neutral,
        }
    }
}

/// One-cell leg lift. `side` is -1 (left of the hip) or 1 (right). `lock` keeps a bridged garment still.
#[derive(Clone, Copy)]
struct LimbShift {
    hip_x: i32,
    hip_y: i32,
    side: i32,
    dy: i32,
    /// Cells away from the hip, in the direction of `side`.
    out: i32,
    lock: bool,
}

/// Step 0 is the rest pose (identical pixels). Step 1 steps the weapon-side foot. Step 2 steps the other.
fn walk_lift(step: u8) -> (i32, i32, i32) {
    match step {
        1 => (1, -2, 1),
        2 => (-1, -2, 1),
        _ => (0, 0, 0),
    }
}

fn garment_bridges(glyphs: &[String], dx: i32, dy: i32, hip_x: i32, hip_y: i32) -> bool {
    for (y, row) in glyphs.iter().enumerate() {
        for (x, c) in row.chars().enumerate() {
            if channel(c).is_none() {
                continue;
            }
            let px = x as i32 + dx;
            let py = y as i32 + dy;
            if py > hip_y && px == hip_x {
                return true;
            }
        }
    }
    false
}

/// Grip travel in cells for one strike frame. Frame 0 is the start of the swing.
/// The held glyph itself is not rotated, so thin blades stay solid.
pub fn strike_grip(overlay: &str, frame: u8) -> (i32, i32) {
    let frame = (frame as usize) % 4;
    let frames: [(i32, i32); 4] = match overlay {
        "slash" => [(-1, -5), (4, -3), (6, 3), (2, 5)],
        "thrust" => [(2, 0), (5, 0), (7, 0), (2, 0)],
        "blunt" => [(0, -5), (1, -2), (2, 5), (0, 2)],
        "shot" | "bow" => [(-3, 0), (-5, 1), (5, -2), (0, 0)],
        "cast" => [(0, -3), (0, -5), (0, -7), (0, -3)],
        "poke" => [(2, 0), (5, 0), (2, 0), (0, 0)],
        "guard" => [(3, -2), (4, -2), (4, -2), (3, -2)],
        "light" => [(0, -2), (0, -5), (0, -2), (0, -2)],
        _ => [(0, 0); 4],
    };
    frames[frame]
}

/// Colors: default chroma → set chroma (if part.`set`) → part chroma.
/// Layer colors come from part chroma, then set chroma.
pub fn compose(kit: &AvatarKit, alpha: u8, step: u8) -> Vec<u8> {
    compose_mood(kit, alpha, step, FaceMood::Neutral)
}

pub fn compose_mood(kit: &AvatarKit, alpha: u8, step: u8, mood: FaceMood) -> Vec<u8> {
    compose_posed(kit, alpha, step, mood, 0, 0)
}

/// `grip_dx` / `grip_dy` shift the held layer. `(0, 0)` leaves it on the hand anchor.
pub fn compose_posed(
    kit: &AvatarKit,
    alpha: u8,
    step: u8,
    mood: FaceMood,
    grip_dx: i32,
    grip_dy: i32,
) -> Vec<u8> {
    let kit = kit.normalized();
    let cat = current_catalog();
    let (group, _scale, rig) = cat.body_meta(&kit.body);
    let ref_rig = cat.ref_rig(&group);
    let mut g = GridBuf::new(GRID, COMPOSE_H);
    let a = alpha.max(1);
    let base = PAD_TOP;
    let (side, lift, out) = walk_lift(step);

    let torso_dx = rig.torso[0] - ref_rig.torso[0];
    let torso_dy = rig.torso[1] - ref_rig.torso[1];
    let face_dx = rig.face[0] - ref_rig.face[0];
    let face_dy = rig.face[1] - ref_rig.face[1];
    let hand_dx = rig.hand[0] - ref_rig.hand[0];
    let hand_dy = rig.hand[1] - ref_rig.hand[1];
    let hip_x = rig.hip[0];
    let hip_y = base + rig.hip[1];
    let outfit_dy = base + torso_dy;
    let lock = cat
        .part("outfit", &kit.outfit)
        .filter(|p| layer_ok_for_group(p, &group))
        .is_some_and(|p| garment_bridges(&p.glyphs, torso_dx, outfit_dy, hip_x, hip_y));
    let shift = LimbShift {
        hip_x,
        hip_y,
        side,
        dy: lift,
        out,
        lock,
    };
    let shift = if side == 0 { None } else { Some(shift) };

    if let Some(p) = cat.part("back", &kit.back) {
        if layer_ok_for_group(p, &group) {
            g.paint(
                &p.glyphs,
                &layer_palette(&cat, p),
                a,
                torso_dx,
                base + torso_dy,
            );
        }
    }
    if let Some(p) = cat.part("body", &kit.body) {
        g.paint_posed(
            &p.glyphs,
            &layer_palette(&cat, p),
            a,
            0,
            base,
            shift,
            (0, 0),
        );
    }
    if let Some(p) = cat.part("outfit", &kit.outfit) {
        if layer_ok_for_group(p, &group) {
            g.paint_posed(
                &p.glyphs,
                &layer_palette(&cat, p),
                a,
                torso_dx,
                outfit_dy,
                shift,
                (0, 0),
            );
        }
    }
    if let Some(p) = cat.part("head", &kit.head) {
        if layer_ok_for_group(p, &group) {
            let (dx, dy) = match HeadAttach::parse(&p.attach) {
                HeadAttach::Perch => {
                    let seat = p.seat.unwrap_or_else(|| infer_seat(&p.glyphs));
                    (rig.crown[0] - seat[0], base + rig.crown[1] - seat[1])
                }
                HeadAttach::Cover => (face_dx, base + face_dy),
                HeadAttach::Flat => (torso_dx, base + torso_dy),
            };
            g.paint(&p.glyphs, &layer_palette(&cat, p), a, dx, dy);
        }
    }
    if let Some(p) = cat.part("held", &kit.held) {
        if layer_ok_for_group(p, &group) {
            g.paint_posed(
                &p.glyphs,
                &layer_palette(&cat, p),
                a,
                hand_dx,
                base + hand_dy,
                None,
                (grip_dx, grip_dy),
            );
        }
    }
    if mood != FaceMood::Neutral {
        let pal = cat
            .part("body", &kit.body)
            .map(|p| layer_palette(&cat, p))
            .unwrap_or_else(default_chroma_palette);
        g.stamp_face(rig.face[0], base + rig.face[1], &pal, a, mood);
    }
    g.px
}

pub fn paint(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    pixel_size: f32,
    facing: i8,
    alpha: u8,
    step: u8,
    kit: &AvatarKit,
) {
    paint_mood(
        pixmap,
        cx,
        cy,
        pixel_size,
        facing,
        alpha,
        step,
        kit,
        FaceMood::Neutral,
        0,
        0,
    )
}

pub fn paint_mood(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    pixel_size: f32,
    facing: i8,
    alpha: u8,
    step: u8,
    kit: &AvatarKit,
    mood: FaceMood,
    grip_dx: i32,
    grip_dy: i32,
) {
    let ps = pixel_size.max(MIN_PIXEL_SIZE).round().max(MIN_PIXEL_SIZE);
    let buf = compose_posed(kit, alpha, step, mood, grip_dx, grip_dy);
    let flip = facing < 0;
    let w = GRID;
    let h = COMPOSE_H;
    let origin_x = (cx - (w as f32) * 0.5 * ps).round();
    let origin_y = (cy - (h as f32) * 0.5 * ps).round();
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            if i + 3 >= buf.len() {
                continue;
            }
            let a = buf[i + 3];
            if a == 0 {
                continue;
            }
            let sx = if flip { w - 1 - x } else { x };
            let dx = origin_x + sx as f32 * ps;
            let dy = origin_y + y as f32 * ps;
            let Some(rect) = Rect::from_xywh(dx, dy, ps, ps) else {
                continue;
            };
            let mut paint = Paint::default();
            paint.set_color_rgba8(buf[i], buf[i + 1], buf[i + 2], a);
            paint.anti_alias = false;
            pixmap.fill_rect(rect, &paint, Transform::identity(), None);
        }
    }
}

pub fn bounds(pixel_size: f32) -> (f32, f32) {
    let ps = pixel_size.max(MIN_PIXEL_SIZE);
    let hx = (GRID as f32) * 0.5 * ps + 4.0;
    let hy = (COMPOSE_H as f32) * 0.5 * ps + 4.0;
    (hx, hy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_fills_shop_defaults() {
        let k = AvatarKit::default().normalized();
        assert_eq!(k.body, "sprite");
        assert_eq!(k.outfit, "cloak");
        assert_eq!(k.held, "staff");
    }

    #[test]
    fn unknown_ids_fall_back() {
        let k = AvatarKit {
            body: "dragon-deluxe".into(),
            head: "hat".into(),
            ..AvatarKit::default()
        }
        .normalized();
        assert_eq!(k.body, "sprite");
        assert_eq!(k.head, "none");
    }

    #[test]
    fn kits_change_pixels() {
        let a = compose(&AvatarKit::default(), 255, 0);
        let b = compose(
            &AvatarKit {
                body: "golem".into(),
                head: "crown".into(),
                outfit: "mail".into(),
                back: "wings".into(),
                held: "blade".into(),
            },
            255,
            0,
        );
        assert_ne!(a.as_slice(), b.as_slice());
        assert!(a.iter().any(|v| *v != 0));
        assert!(b.iter().any(|v| *v != 0));
        assert_eq!(a.len(), (GRID * COMPOSE_H * 4) as usize);
    }

    #[test]
    fn hit_moods_change_the_face() {
        let kit = AvatarKit::default();
        let neutral = compose(&kit, 255, 0);
        let hurt = compose_mood(&kit, 255, 0, FaceMood::Hurt);
        let angry = compose_mood(&kit, 255, 0, FaceMood::Angry);
        assert_ne!(neutral, hurt);
        assert_ne!(neutral, angry);
        assert_ne!(hurt, angry);
    }

    #[test]
    fn body_scales_differ_by_species() {
        let human = body_scale(&AvatarKit {
            body: "human".into(),
            ..AvatarKit::default()
        });
        let dwarf = body_scale(&AvatarKit {
            body: "dwarf".into(),
            ..AvatarKit::default()
        });
        let golem = body_scale(&AvatarKit {
            body: "golem".into(),
            ..AvatarKit::default()
        });
        assert!((human - 1.0).abs() < f32::EPSILON);
        assert!(dwarf < 0.8 && dwarf < human);
        assert!(golem > 1.4 && golem > human);
        let imp = body_scale(&AvatarKit {
            body: "imp".into(),
            ..AvatarKit::default()
        });
        assert!(imp < 0.6);
        assert!(golem / imp > 2.0);
        assert!(
            display_pixel_size(
                &AvatarKit {
                    body: "imp".into(),
                    ..AvatarKit::default()
                },
                1.0
            ) >= MIN_PIXEL_SIZE
        );
        assert!(
            display_pixel_size(
                &AvatarKit {
                    body: "halfling".into(),
                    ..AvatarKit::default()
                },
                1.0
            ) >= MIN_PIXEL_SIZE
        );
    }

    #[test]
    fn tiny_bodies_still_rasterize() {
        for body in ["imp", "halfling"] {
            let kit = AvatarKit {
                body: body.into(),
                head: "none".into(),
                outfit: "none".into(),
                back: "none".into(),
                held: "none".into(),
            };
            let rgba = compose(&kit, 255, 0);
            assert!(rgba.iter().any(|b| *b != 0), "{body} empty");
        }
    }

    #[test]
    fn part_chroma_overrides_layer_color() {
        let kit = AvatarKit {
            body: "human".into(),
            head: "none".into(),
            outfit: "none".into(),
            back: "none".into(),
            held: "none".into(),
        };
        let before = compose(&kit, 255, 0);
        let after = compose(&kit, 255, 0);
        assert_eq!(before, after);

        let cat = current_catalog();
        let body = cat.part("body", "human").expect("human");
        assert!(body.chroma.is_some(), "bodies should ship default chroma");
        let skin = body.chroma.as_ref().and_then(|c| c.skin);
        assert_eq!(skin, Some([232, 196, 168]));
    }

    #[test]
    fn chroma_merge_order_is_default_set_part() {
        let base = default_chroma_palette();
        let set = PartChroma {
            metal: Some([10, 20, 30]),
            cloth: Some([40, 50, 60]),
            ..PartChroma::default()
        };
        let part = PartChroma {
            accent: Some([70, 80, 90]),
            cloth: Some([1, 2, 3]),
            ..PartChroma::default()
        };
        let pal = part.merge_over(&set.merge_over(&base));
        assert_eq!(pal.metal, [10, 20, 30]);
        assert_eq!(pal.cloth, [1, 2, 3]);
        assert_eq!(pal.accent, [70, 80, 90]);
        assert_eq!(pal.skin, base.skin);
    }

    #[test]
    fn set_members_inherit_set_chroma() {
        let cat = current_catalog();
        let plate = cat.part("outfit", "plate").expect("plate");
        assert_eq!(plate.set, "crusader");
        assert!(
            plate.chroma.is_none(),
            "set members should omit chroma and inherit from the set"
        );
        let set = cat
            .sets
            .iter()
            .find(|s| s.id == "crusader")
            .expect("crusader");
        assert!(set.chroma.is_some());
        let pal = layer_palette(&cat, plate);
        assert_eq!(pal.metal, set.chroma.as_ref().unwrap().metal.unwrap());
    }

    #[test]
    fn wizard_hat_perch_sits_on_crown() {
        let kit = AvatarKit {
            body: "sprite".into(),
            head: "wizard-hat".into(),
            outfit: "none".into(),
            back: "none".into(),
            held: "none".into(),
        };
        let buf = compose(&kit, 255, 0);
        let w = GRID as usize;
        let h = COMPOSE_H as usize;
        // Body crown is at glyph y=3 → compose y = PAD_TOP+3 = 7.
        // Hat seat y=7 maps to crown, so hat tip (glyph y=0) lands at compose y=0.
        let tip = {
            let i = (0 * w + 10) * 4;
            buf[i + 3]
        };
        assert!(tip > 0, "hat tip should remain in top pad");
        // Face row on sprite (~ glyph y=6 → compose 10) should not be solid hat brim only;
        // brim was previously at compose y=6+4 without perch. With perch, brim is at crown.
        let crown_row = (PAD_TOP + 3) as usize;
        let mut brim_on_crown = false;
        for x in 8..16 {
            let i = (crown_row * w + x) * 4;
            if buf[i + 3] > 0 {
                brim_on_crown = true;
                break;
            }
        }
        assert!(brim_on_crown, "hat should occupy crown row");
        let _ = h;
    }

    #[test]
    fn catalog_parts_are_24x24() {
        let cat = current_catalog();
        assert!(cat.parts.len() >= 10);
        for part in &cat.parts {
            validate_part(part).unwrap();
        }
        assert!(cat.part("body", "sprite").is_some());
    }

    #[test]
    fn held_parts_share_actions_by_kind() {
        let cat = current_catalog();
        let slash = cat
            .held_actions
            .iter()
            .find(|action| action.id == "slash")
            .expect("slash action");
        assert_eq!(slash.role, "weapon");
        assert!(!slash.overlay.is_empty());
        let blade = cat.part("held", "blade").unwrap();
        let axe = cat.part("held", "greataxe").unwrap();
        assert_eq!(blade.weapon_kind, "slash");
        assert_eq!(axe.weapon_kind, blade.weapon_kind);
        let lantern = cat.part("held", "lantern").unwrap();
        assert_eq!(lantern.weapon_kind, "light");
        assert!(cat
            .held_actions
            .iter()
            .any(|action| action.id == "light" && action.role == "prop"));
        for part in cat.parts.iter().filter(|part| part.slot == "held") {
            assert!(
                cat.held_actions
                    .iter()
                    .any(|action| action.id == part.weapon_kind),
                "held {} kind {}",
                part.id,
                part.weapon_kind
            );
        }
        assert!(cat.warnings.iter().all(|warning| !warning.contains("weaponKind")));
    }

    #[test]
    fn crusader_set_is_in_catalog() {
        let cat = current_catalog();
        assert!(cat.part("head", "greathelm").is_some());
        assert!(cat.part("outfit", "plate").is_some());
        assert!(cat.part("back", "crusader").is_some());
        assert!(cat.part("held", "shield").is_some());
        assert!(cat.sets.iter().any(|s| s.id == "crusader"));
        let kit = apply_set(&AvatarKit::default(), "crusader");
        assert_eq!(kit.head, "greathelm");
        assert_eq!(kit.outfit, "plate");
        assert_eq!(kit.back, "crusader");
        assert_eq!(kit.held, "shield");
        assert_eq!(kit.body, "sprite");
    }

    #[test]
    fn runtime_part_is_composed_and_hidden_from_catalog() {
        let id = "11111111-1111-4111-8111-111111111111";
        let row = "S".repeat(GRID as usize);
        reset_runtime_parts();
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                reset_runtime_parts();
            }
        }
        let _reset = Reset;
        install_runtime_parts(vec![AvatarStudioPart {
            id: id.into(),
            slot: "body".into(),
            set: String::new(),
            shop: false,
            ko: "custom".into(),
            en: "custom".into(),
            glyphs: vec![row; GRID as usize],
            group: String::new(),
            scale: 1.0,
            rig: None,
            attach: String::new(),
            seat: None,
            fits: Vec::new(),
            chroma: None,
            weapon_kind: String::new(),
        }])
        .unwrap();
        let custom = compose(
            &AvatarKit {
                body: id.into(),
                ..AvatarKit::default()
            },
            255,
            0,
        );
        let fallback = compose(
            &AvatarKit {
                body: "no-such-body".into(),
                ..AvatarKit::default()
            },
            255,
            0,
        );
        assert_ne!(custom, fallback);
        assert!(current_catalog()
            .dto()
            .parts
            .iter()
            .all(|part| part.id != id));
        reset_runtime_parts();
    }

    #[test]
    fn rejects_unknown_glyph() {
        let mut part = current_catalog().part("body", "sprite").unwrap().clone();
        part.glyphs[0] = "X".repeat(GRID as usize);
        assert!(validate_part(&part).is_err());
    }

    fn bare(body: &str, outfit: &str) -> AvatarKit {
        AvatarKit {
            body: body.into(),
            head: "none".into(),
            outfit: outfit.into(),
            back: "none".into(),
            held: "none".into(),
        }
    }

    #[test]
    fn bodies_carry_hip_and_shoulder() {
        let cat = current_catalog();
        for part in cat.parts.iter().filter(|part| part.slot == "body") {
            let rig = part.rig.expect(&part.id);
            assert!(rig.hip[1] > rig.torso[1], "{} hip", part.id);
            assert!(rig.shoulder[0] > 0, "{} shoulder", part.id);
        }
    }

    #[test]
    fn rest_pose_matches_step_zero_and_walk_lifts_a_foot() {
        let kit = bare("human", "none");
        let rest = compose(&kit, 255, 0);
        let again = compose_posed(&kit, 255, 0, FaceMood::Neutral, 0, 0);
        assert_eq!(rest, again);
        let step = compose(&kit, 255, 1);
        assert_ne!(rest, step);
        let other = compose(&kit, 255, 2);
        assert_ne!(rest, other);
        assert_ne!(step, other);
    }

    #[test]
    fn robe_keeps_legs_still() {
        let kit = bare("human", "robe");
        assert_eq!(compose(&kit, 255, 0), compose(&kit, 255, 1));
    }

    #[test]
    fn strike_shifts_the_held_part() {
        let kit = AvatarKit {
            body: "human".into(),
            head: "none".into(),
            outfit: "none".into(),
            back: "none".into(),
            held: "blade".into(),
        };
        let rest = compose(&kit, 255, 0);
        let (dx, dy) = strike_grip("slash", 0);
        assert_eq!((dx, dy), (-1, -5));
        let swung = compose_posed(&kit, 255, 0, FaceMood::Neutral, dx, dy);
        assert_ne!(rest, swung);
        assert_eq!(strike_grip("thrust", 2).0, 7);
        assert_eq!(strike_grip("shot", 1).0, -5);
    }
}
