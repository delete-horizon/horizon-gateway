# Avatar parts

24×24 pixel-art layers for the comm overlay. **One JSON file = one part SKU.** A **set** in `sets.json` is the shop bundle SKU that grants several parts.

## SKUs (shop later)

| Kind | Stable id | Example |
| --- | --- | --- |
| Part | `{slot}:{id}` | `head:greathelm` |
| Set | `set:{id}` | `set:crusader` |

Do not persist slot index numbers. Equipped kits store **string ids**. Adding a file must not remap someone else's wings.

## Loop

1. Read this file and `.agents/skills/avatar-parts/SKILL.md`.
2. Copy a nearby `{slot}-{id}.json` in the same slot.
3. Change `id`, `ko`, `en`, `shop`, optional `set`, and the 24 glyph rows.
4. Save as `{slot}-{id}.json` (filename must match `slot` + `id`).
5. If the parts belong together, add or update an entry in `sets.json`.
6. `cargo test -p hg-avatar`
7. Open **Avatar studio** or Overlay lab and **Reload catalog**. Overlay uses the on-disk catalog after reload (or a Tauri restart).

Do not edit `src-tauri/hg-gui/src/comm_overlay/avatar.rs` to add a part. Do not add TypeScript catalog entries.

## Glyph alphabet

Each part is **exactly 24 lines**, each **exactly 24 characters**. Only:

| Char | Channel | Use |
| --- | --- | --- |
| `.` | empty | Transparent. Most of the grid. |
| `O` | outline | Silhouette / dark edge |
| `S` | skin | Light flesh / stone face |
| `D` | skinD | Shadow on skin |
| `C` | cloth | Main cloth |
| `K` | clothD | Fold / shadow cloth |
| `A` | accent | Gem, flame, trim |
| `M` | metal | Armor, staff, blade |
| `E` | eye | Pupil |
| `W` | white | Eye white, shine |

No other characters. No tabs. UTF-8. `none` is a reserved empty slot — do not create `none.json`.

## JSON shape

```json
{
  "id": "sprite",
  "slot": "body",
  "shop": false,
  "ko": "스프라이트",
  "en": "Sprite",
  "glyphs": ["........................"]
}
```

`glyphs` must contain 24 strings. `slot` is one of `body` | `head` | `outfit` | `back` | `held`. `id` is kebab-case `[a-z][a-z0-9-]{0,31}`.

Colors come from each part's `chroma`, with set `chroma` filling any channel the part omits.

### Chroma (per part)

```json
"chroma": {
  "outline": [28, 18, 44],
  "skin": [232, 196, 168],
  "skinD": [180, 132, 112],
  "cloth": [88, 64, 148],
  "clothD": [48, 32, 92],
  "accent": [180, 140, 255],
  "metal": [188, 176, 220],
  "eye": [28, 22, 40],
  "white": [250, 246, 255]
}
```

- **body**: keep `skin` / `skinD` as species identity (agents may specialize later).
- **outfit / head / back / held**: specialize `cloth` / `metal` / `accent`.
- Missing channels fall back to the shared default (former dusk). Standalone parts ship a full default `chroma` block.
- **Set inheritance:** put shared colors on `sets.json` → `chroma`. Parts with `"set": "crusader"` omit `chroma` to inherit; override only channels that differ on that part.

```json
// sets.json
{ "id": "crusader", "chroma": { "metal": [220, 200, 120], "cloth": [180, 180, 200] }, "kit": { ... } }

// outfit-plate.json — inherits set chroma
{ "id": "plate", "set": "crusader", "glyphs": [...] }

// held-shield.json — only accent differs
{ "id": "shield", "set": "crusader", "chroma": { "accent": [60, 100, 180] }, "glyphs": [...] }
```

## Layer order

Back → body → outfit → head → held. Later slots overwrite overlapping pixels. Optional slots may be `none`. Body cannot be `none`.

A walk lifts one foot below the hip by two cells and steps it one cell outward, alternating sides (`step` 1, then 2). Step 0 is the rest pose and does not move pixels. A garment that fills the hip column (a robe) keeps both legs still. A strike shifts the held part several cells along that kind's arc; the glyph itself is not rotated. Keep feet near `y=21`.

## Silhouette groups, scale, and rigs

Parts belong to a **silhouette group** (`groups.json`). Today everything is `humanoid` @ grid 24.

| Field | Where | Meaning |
| --- | --- | --- |
| `group` | body | Silhouette family id |
| `scale` | body | Height within the group (`human` = 1.0). Display only — does not change glyph grid |
| `rig` | body | `crown` / `face` / `torso` / `hand` / `hip` / `shoulder` anchor points `[x,y]` |
| `fits` | skins | Groups that may wear this part |
| `attach` | head | `perch` (hat on crown) or `cover` (hood/helm on face) |
| `seat` | head perch | Brim / sit point `[x,y]` mapped onto body `crown` |

Skins follow the group (`fits`). Same-group size differences use **scale**. A different **grid** is reserved for a new group later, not for making a dwarf taller.

## Held actions

Hand parts set `weaponKind` to an id in `held-actions.json`. Every part of one kind shares that row's action. Add a kind by appending a row (`id`, `role` of `weapon` | `prop` | `unarmed`, labels, and `overlay`). `overlay` is the comm effect name (`slash`, `thrust`, `blunt`, `shot`, `cast`, `guard`, `light`, `poke`). Do not add a handler per part.

| kind | role | parts |
| --- | --- | --- |
| `slash` | weapon | blade, greataxe, scythe |
| `thrust` | weapon | dagger, rapier |
| `blunt` | weapon | mace, bo-staff |
| `bow` | weapon | bow |
| `cast` | weapon | staff, oak-staff, grimoire |
| `guard` | weapon | shield |
| `light` | prop | lantern |
| `poke` | unarmed | empty hand |

Reference body for `humanoid` is `human` — outfit/held art is authored to that rig and shifted per body anchors when composed.

### Humanoid display scales (approx.)

| body | scale | feel |
| --- | --- | --- |
| golem | 1.55 | 거대 |
| orc | 1.22 | 큼 |
| elf | 1.18 | 큼/마름 |
| human | 1.00 | 기준 |
| scout | 0.95 | 약간 작음 |
| sprite | 0.72 | 소형 |
| dwarf | 0.70 | 작고 넓음 |
| halfling | 0.62 | 더 작음 |
| imp | 0.55 | 꼬마 |

### Big-head / animal chibi

Do **not** fake this with `scale` on a humanoid body. Add a `body` with `group: "chibi"`, a head-heavy glyph footprint, and chibi-only skins (`fits: ["chibi"]`: glasses, ribbons, tiny hats). Humanoid plate/robes stay on `humanoid`. Same 24 grid for now; open a larger grid only if chibi art outgrows it.

## Shop

`"shop": true` on a **part** means that SKU can be sold or previewed as paid. `"shop": true` on a **set** is the bundle customers buy; grant the listed part ids.

## Sets

`sets.json` is not a drawable part. A set applies several slots at once. Empty kit fields keep whatever the avatar already wears.

```json
{
  "sets": [
    {
      "id": "crusader",
      "ko": "성기사",
      "en": "Crusader",
      "shop": true,
      "kit": {
        "head": "greathelm",
        "outfit": "plate",
        "back": "crusader",
        "held": "shield"
      }
    }
  ]
}
```

Tag each member part with `"set": "crusader"` so lists can group them. Set `chroma` is the shared color for those parts.
