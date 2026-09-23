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
}

impl AvatarRig {
    const HUMAN: Self = Self {
        crown: [12, 3],
        face: [12, 7],
        torso: [12, 14],
        hand: [16, 15],
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
    #[serde(default)]
    pub palette: String,
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
            palette: cat.canon("palette", &self.palette, "dusk"),
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
            palette: cat.idx("palette", &n.palette),
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
    pub palette: u8,
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
            palette: cat.pick("palette", self.palette, "dusk"),
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
pub struct AvatarStudioPalette {
    pub id: String,
    pub ko: String,
    pub en: String,
    #[serde(default)]
    pub shop: bool,
    pub outline: [u8; 3],
    pub skin: [u8; 3],
    pub skin_d: [u8; 3],
    pub cloth: [u8; 3],
    pub cloth_d: [u8; 3],
    pub accent: [u8; 3],
    pub metal: [u8; 3],
    pub eye: [u8; 3],
    pub white: [u8; 3],
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarStudioCatalog {
    pub parts: Vec<AvatarStudioPart>,
    pub palettes: Vec<AvatarStudioPalette>,
    #[serde(default)]
    pub sets: Vec<AvatarStudioSet>,
    #[serde(default)]
    pub groups: Vec<AvatarGroup>,
    #[serde(default)]
    pub warnings: Vec<String>,
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
struct PalettesFile {
    palettes: Vec<AvatarStudioPalette>,
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

impl From<&AvatarStudioPalette> for Palette {
    fn from(p: &AvatarStudioPalette) -> Self {
        Self {
            outline: p.outline,
            skin: p.skin,
            skin_d: p.skin_d,
            cloth: p.cloth,
            cloth_d: p.cloth_d,
            accent: p.accent,
            metal: p.metal,
            eye: p.eye,
            white: p.white,
        }
    }
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
    palettes: Vec<AvatarStudioPalette>,
    sets: Vec<AvatarStudioSet>,
    groups: Vec<AvatarGroup>,
    warnings: Vec<String>,
    body_ids: Vec<String>,
    head_ids: Vec<String>,
    outfit_ids: Vec<String>,
    back_ids: Vec<String>,
    held_ids: Vec<String>,
    palette_ids: Vec<String>,
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
        if dto.palettes.is_empty() {
            return Err("palettes.json has no palettes".into());
        }
        for pal in &dto.palettes {
            validate_id(&pal.id)?;
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
        for set in &dto.sets {
            validate_id(&set.id)?;
            for (slot, id) in [
                ("body", set.kit.body.as_str()),
                ("head", set.kit.head.as_str()),
                ("outfit", set.kit.outfit.as_str()),
                ("back", set.kit.back.as_str()),
                ("held", set.kit.held.as_str()),
                ("palette", set.kit.palette.as_str()),
            ] {
                if id.is_empty() || id == "none" {
                    continue;
                }
                let exists = if slot == "palette" {
                    dto.palettes.iter().any(|p| p.id == id)
                } else {
                    dto.parts.iter().any(|p| p.slot == slot && p.id == id)
                };
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
            palette_ids: dto.palettes.iter().map(|p| p.id.clone()).collect(),
            parts: dto.parts,
            palettes: dto.palettes,
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
            "palette" => &self.palette_ids,
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

    fn palette(&self, id: &str) -> Palette {
        self.palettes
            .iter()
            .find(|p| p.id == id)
            .map(Palette::from)
            .or_else(|| self.palettes.first().map(Palette::from))
            .unwrap_or(Palette {
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

    fn dto(&self) -> AvatarStudioCatalog {
        AvatarStudioCatalog {
            parts: self.parts.clone(),
            palettes: self.palettes.clone(),
            sets: self.sets.clone(),
            groups: self.groups.clone(),
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
    let palettes_path = dir.join("palettes.json");
    let palettes: PalettesFile = serde_json::from_str(
        &std::fs::read_to_string(&palettes_path)
            .map_err(|e| format!("{}: {e}", palettes_path.display()))?,
    )
    .map_err(|e| format!("palettes.json: {e}"))?;
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
        if name == "palettes.json" || name == "sets.json" || name == "groups.json" {
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
        palettes: palettes.palettes,
        sets,
        groups,
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
    cands
        .into_iter()
        .find(|p| p.join("palettes.json").is_file())
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
        palette: keep(&base.palette, &set.kit.palette),
    }
    .normalized()
}

pub fn reload_from_disk() -> Result<AvatarStudioCatalog, String> {
    let cat = Arc::new(load_best()?);
    let dto = cat.dto();
    *store().write() = cat;
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
        for (y, row) in glyphs.iter().enumerate() {
            for (x, c) in row.chars().enumerate() {
                if let Some(ch) = channel(c) {
                    self.put(x as i32 + dx, y as i32 + dy, rgb(pal, ch), a);
                }
            }
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

/// Colors: default chroma → set chroma (if part.`set`) → part chroma.
/// Kit palette is legacy and does not recolor layers.
pub fn compose(kit: &AvatarKit, alpha: u8, step: u8) -> Vec<u8> {
    let kit = kit.normalized();
    let cat = current_catalog();
    let (group, _scale, rig) = cat.body_meta(&kit.body);
    let ref_rig = cat.ref_rig(&group);
    let mut g = GridBuf::new(GRID, COMPOSE_H);
    let a = alpha.max(1);
    let foot = if step % 2 == 1 { -1 } else { 0 };
    let base = PAD_TOP;

    let torso_dx = rig.torso[0] - ref_rig.torso[0];
    let torso_dy = rig.torso[1] - ref_rig.torso[1];
    let face_dx = rig.face[0] - ref_rig.face[0];
    let face_dy = rig.face[1] - ref_rig.face[1];
    let hand_dx = rig.hand[0] - ref_rig.hand[0];
    let hand_dy = rig.hand[1] - ref_rig.hand[1];

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
        g.paint(&p.glyphs, &layer_palette(&cat, p), a, 0, base + foot);
    }
    if let Some(p) = cat.part("outfit", &kit.outfit) {
        if layer_ok_for_group(p, &group) {
            g.paint(
                &p.glyphs,
                &layer_palette(&cat, p),
                a,
                torso_dx,
                base + torso_dy + foot,
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
            g.paint(
                &p.glyphs,
                &layer_palette(&cat, p),
                a,
                hand_dx,
                base + hand_dy,
            );
        }
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
    let ps = pixel_size.max(MIN_PIXEL_SIZE).round().max(MIN_PIXEL_SIZE);
    let buf = compose(kit, alpha, step);
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
        assert_eq!(k.palette, "dusk");
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
                palette: "ice".into(),
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
                palette: "dusk".into(),
            };
            let rgba = compose(&kit, 255, 0);
            assert!(rgba.iter().any(|b| *b != 0), "{body} empty");
        }
    }

    #[test]
    fn part_chroma_overrides_layer_color() {
        let mut kit = AvatarKit {
            body: "human".into(),
            head: "none".into(),
            outfit: "none".into(),
            back: "none".into(),
            held: "none".into(),
            palette: "moss".into(),
        };
        let before = compose(&kit, 255, 0);
        // Moss palette must not recolor body when chroma is on the part.
        kit.palette = "ember".into();
        let after = compose(&kit, 255, 0);
        assert_eq!(
            before, after,
            "kit palette should not recolor per-part chroma"
        );

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
            palette: "dusk".into(),
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
        assert!(cat.palettes.iter().any(|p| p.id == "dusk"));
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
    fn rejects_unknown_glyph() {
        let mut part = current_catalog().part("body", "sprite").unwrap().clone();
        part.glyphs[0] = "X".repeat(GRID as usize);
        assert!(validate_part(&part).is_err());
    }
}
