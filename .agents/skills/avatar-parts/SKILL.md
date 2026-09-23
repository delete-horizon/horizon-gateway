---
name: avatar-parts
description: Author 24×24 pixel-art overlay parts as ASCII JSON for Horizon Gateway. Use when adding avatar skins, body/head/outfit/back/held parts, palettes, or when Gemini/an agent is asked to draw a new part for the comm overlay.
---

# Avatar parts (agent)

Horizon Gateway overlay characters are **layered 24×24 pixel art**. Each part is one JSON file and a future shop SKU. Do **not** edit Rust cell arrays.

## Read first

- `avatar-parts/README.md` — alphabet, layer order, shop flag
- Copy a file in the same `slot/`, do not start from a blank 24×24 unless asked

## Write

Path: `avatar-parts/{slot}-{id}.json`

```json
{
  "id": "horns",
  "slot": "head",
  "set": "crusader",
  "shop": false,
  "ko": "뿔",
  "en": "Horns",
  "glyphs": ["........................"]
}
```

Rules:

- `glyphs`: **24 strings × 24 chars**. Alphabet: `. O S D C K A M E W` only
- `slot`: `body` | `head` | `outfit` | `back` | `held`
- `id`: kebab-case, not `none` / `default`
- Filename must be `{slot}-{id}.json`
- Optional `"set": "crusader"` groups the part under a bundle
- Transparent = `.` (most pixels). Keep the silhouette inside the grid; feet near row 21
- Head/outfit/back/held: prefer set-level `chroma` in `sets.json`; omit part `chroma` to inherit, or override one channel
- Body parts may set `group`, `scale` (1.0 = human height), `rig`, and `chroma.skin` / `chroma.skinD`
- Head parts may set `attach`: `perch` (wizard hat) or `cover` (hood), plus optional `seat`
- Skins set `fits: ["humanoid"]` so they follow the silhouette group
- `"shop": true` = planned paid SKU (still previewable)
- Kit `palette` is legacy; compose uses per-part `chroma`, not the global palette
- Bundles go in `avatar-parts/sets.json` (`set:{id}`), not as a fake body part
- Groups live in `avatar-parts/groups.json` (grid + reference body)

Layer order when composed: **back → body → outfit → head → held**.

Shop later: persist `{slot}:{id}` and `set:{id}` strings. Never store slot index numbers.

## Check

```bash
cargo test -p hg-avatar
```

Open the desktop **Avatar studio** or Overlay lab and hit **Reload catalog**. Do not add TypeScript catalog entries.

If the user asked for a themed outfit, also add `sets.json` so the lab has one “wear this set” button. If the user asked only for a concept sketch, still emit valid JSON they can drop in `avatar-parts/`.
