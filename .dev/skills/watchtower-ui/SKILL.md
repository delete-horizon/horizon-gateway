---
name: watchtower-ui
description: UI layout, typography, card patterns, spacing, and theme conventions for Watchtower (Horizon Gateway). Use when building or refactoring settings pages, panels, forms, cards, buttons, inputs, or applying custom themes.
---

# Watchtower UI Guidelines

Cursor-style minimal UI conventions for Watchtower (Horizon Gateway). Follow these patterns when adding or refactoring UI.

**Related skills:** [horizon-gateway](../../../.agents/skills/horizon-gateway/SKILL.md) (CLI, API logs, proxy) · page-specific UI/UX guides via `hgc get_annotations`.

---

## 1. Section layout — title OUTSIDE card, flat nesting

**Canonical pattern.** Section headings and descriptions sit above a **single** card; the card holds only interactive content or data fields.

```tsx
import { Card } from "@/shared/ui/card/card";

<section className="space-y-2 min-w-0">
  <h2 className="text-sm font-semibold text-base-content">{title}</h2>
  {desc && <p className="text-xs text-base-content/55 leading-relaxed">{desc}</p>}
  <Card className="p-3 @min-[32rem]:p-4 space-y-3 min-w-0">
    {/* controls, inputs, code blocks — no nested bordered sub-panels */}
  </Card>
</section>
```

### Flat nesting — avoid “box in box”

Do **not** stack bordered/shadowed containers (Card → bordered div → bordered field). Prefer one surface per section.

| Layer | Belongs outside card | Belongs inside card (only) |
|-------|----------------------|----------------------------|
| Section title (H2) | ✅ | ❌ |
| Section description | ✅ | ❌ |
| Form controls, toggles, inputs | ❌ | ✅ |
| Data/code display (PAC URL, JSON body) | ❌ | ✅ |
| Subsection label (H3) | ✅ above its fields, or plain text inside | Avoid H3 + wrapper border |

**Do NOT**

```tsx
// ❌ Title inside card
<Card>
  <h2>{title}</h2>
  <p>{desc}</p>
  <Input />
</Card>

// ❌ Card wrapping another bordered panel
<Card>
  <div className="rounded-xl border border-base-300 bg-base-200/50 p-4">
    <h3>Primary</h3>
    <div className="rounded-lg border ..."><ColorPicker /></div>
  </div>
</Card>

// ❌ Card + inner content box with its own border (API viewer)
<Card>
  <Tabs />
  <div className="border border-base-300 bg-base-200 rounded-lg">...</div>
</Card>
```

**Do**

```tsx
// ✅ Description outside; one card for controls
<section className="space-y-2">
  <h2>PAC URL</h2>
  <p className="text-xs text-base-content/55">{desc}</p>
  <Card className="p-3 flex gap-2">
    <code className="flex-1 text-xs font-mono break-all">{url}</code>
    <Button>Copy</Button>
  </Card>
</section>

// ✅ Subgroups as flat grid inside one card (theme editor colors)
<Card>
  <div className="grid grid-cols-4 gap-4">
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Primary</h3>
      <ColorField /> {/* no extra border wrapper */}
    </div>
  </div>
</Card>
```

Use `Card variant="subtle"` only when a **sibling** block needs slight separation inside the same section — never Card ⊃ bordered Card.

### Multi-column tool layouts (crypto sandbox, API client)

Grid **columns are layout regions, not cards.** Do not wrap an entire column in `card border shadow-sm`.

| Column role | Outside card | Inside single card |
|-------------|--------------|-------------------|
| Sidebar list | H2 + search + actions | Preset/list rows only |
| Editor | H2 + toolbar (save, badges) | Form fields + primary action |
| Output | H2 + copy action | Result body only |

Reference: `src/entities/sandbox/ui/CryptoNode.tsx` (standalone `layout="page"`).

### Do NOT (legacy)

```tsx
// ❌ Description inside card (old pattern)
<Card>
  <p>{desc}</p>
  {controls}
</Card>
```

### Reference implementations

| Page | File |
|------|------|
| Settings (proxy + app tabs) | `src/features/popup-window/ui/SettingsContent.tsx` — `Section` component |
| API request form sections | `src/entities/api-request/ui/ApiRequestForm.tsx` — `FormSection` helper |

### Page-level spacing

```tsx
// Settings panel content area
className="p-3 @min-[32rem]:p-4 @min-[48rem]:p-5 space-y-6 max-w-3xl"

// Full-page sections (proxy setup)
className="flex flex-col gap-6 max-w-3xl mx-auto w-full pb-16"
```

- **Between sections:** `space-y-6` or `gap-6` (24px)
- **Title → card:** `space-y-2` on `<section>`
- **Inside card:** `space-y-3`

---

## 2. Typography

Base density follows Cursor: **13px / line-height 1.4** (set in theme presets and injected at runtime).

| Element | Classes | Notes |
|---------|---------|-------|
| Page title (H1) | `text-xl font-semibold tracking-tight` | `typography.tsx` H1 |
| Section title (H2) | `text-sm font-semibold text-base-content` | Outside card |
| Subsection (H3) | `text-sm font-semibold` | Inside card when needed |
| Body | `text-sm` | Default via P/Span |
| Section description | `text-xs text-base-content/55 leading-relaxed` | **Outside** card, under H2 |
| Field label | `text-[10px] font-medium text-base-content/50` | No uppercase |
| Hint / placeholder | `text-base-content/40` | Muted helper text |

### Opacity tokens

| Token | Use |
|-------|-----|
| `text-base-content/55` | Secondary text, descriptions, nav inactive |
| `text-base-content/50` | Field labels, legends |
| `text-base-content/40` | Hints, empty states, disabled icons |
| `text-base-content/35` | Very muted icons |

**Avoid** mixing `/60`, `/70` for secondary copy — prefer `/55`.

### No uppercase labels

Do not use `uppercase` on section or field labels. Use `font-medium` at 10px instead.

---

## 3. Card component

**File:** `src/shared/ui/card/card.tsx`

Default variant is **`flat`** (Cursor style: no border, no shadow).

| Variant | Use |
|---------|-----|
| `flat` (default) | Settings sections, content panels |
| `bordered` | Legacy / emphasis (border + shadow) |
| `subtle` | Rare sibling emphasis inside one section — not nested inside another card |

```tsx
<Card variant="flat" className="p-5 space-y-3">...</Card>
```

Alert/status blocks (warning, success) may use `Card` with semantic colors directly — they are not section cards.

---

## 4. Buttons & inputs

**Button** (`src/shared/ui/button/Button.tsx`):

| Size | Classes |
|------|---------|
| `sm` | `btn-sm h-7 px-2.5 text-xs` |
| `secondary` | `hover:bg-base-200/60` — subtle hover |

Settings actions: `variant="secondary" size="sm"`.

**Input** (`src/shared/ui/input/Input.tsx`):

```
text-xs h-8 focus:border-primary/50
```

For number fields in settings, add `className="h-9 text-sm w-full"` when slightly larger touch targets are needed.

---

## 5. Theme system

### Files

| File | Role |
|------|------|
| `src/global.css` | Build-time DaisyUI theme registration (`@plugin daisyui/theme`) |
| `src/entities/app/theme/presets.ts` | Default dark/light themes (`baseFontSize: 13`, `lineHeight: 1.4`) |
| `src/entities/app/theme/applyTheme.ts` | Runtime CSS variable injection + `data-theme` |
| `src/entities/app/theme/store.ts` | Active theme persistence |
| `src/routes/__root.tsx` | App-wide `applyThemeToDocument` on active theme changes |
| `src/features/theme-editor/ui/ThemeEditorPanel.tsx` | User theme editor |

### Theme Token Injection

#### Architecture

1. **Build time:** `src/global.css` lists `horizon-gateway-light` / `horizon-gateway-dark` in `@plugin "daisyui"` and defines full token sets (including every `*-content` pair and `color-scheme`) via `@plugin "daisyui/theme"`.
2. **Runtime:** `applyThemeToDocument()` runs from `src/routes/__root.tsx` whenever the active theme changes. It resolves a **compiled DaisyUI theme id**, sets `data-theme` on `<html>`, and injects overrides through `#custom-active-theme` on both `:root` and `[data-theme="<compiled-id>"]`.

#### Root causes fixed (v2.8.0)

- **No app-wide apply:** Theme injection was not guaranteed on every route until `__root.tsx` subscribed to the active theme and called `applyThemeToDocument`.
- **Missing `-content` tokens:** Compiled themes omitted semantic `*-content` variables, so text/icon colors did not match design tokens.
- **Wrong `data-theme` id:** Runtime used user `custom-theme-*` ids on `data-theme`, but only `horizon-gateway-light` / `horizon-gateway-dark` exist in the compiled DaisyUI theme list, so selectors never matched.

#### Rules for agents

- Set `data-theme` on `<html>` to **`horizon-gateway-light`** or **`horizon-gateway-dark`** only (use `resolveDaisyThemeId()` in `applyTheme.ts`; built-in presets use their own id; custom themes map from `theme.base`).
- **Never** put `custom-theme-*` or other user-defined ids on `data-theme`.
- When editing compiled themes in `global.css`, add **both** base colors and matching **`-content`** tokens, plus `color-scheme`.
- Custom `@plugin "daisyui/theme"` blocks must also define shape tokens: `--radius-field` (buttons/inputs), `--radius-box` (cards/modals), `--radius-selector` (badges/toggles), `--size-field`, `--size-selector`, `--border`, `--depth`, `--noise`. Missing `--radius-field` breaks `.btn` border-radius.
- Keep runtime overrides on `:root` and `[data-theme="<compiled-id>"]` with `!important` unless DaisyUI layering is re-audited.
- **Never** inject theme tokens (e.g. `--color-primary`) via a separate `#dynamic-theme` style tag after `applyThemeToDocument`; use only `#custom-active-theme` from `applyTheme.ts`. Stale `#dynamic-theme` is removed at apply time; duplicate injection causes token conflicts (e.g. avatar primary).

#### Known follow-ups

- **FOUC in `index.html`:** First paint may flash before React runs `applyThemeToDocument`; consider an inline boot snippet or persisted theme snapshot.
- **LivePreviewer sync:** Theme editor live preview should mirror the same compiled-id + injection path as production.

### How theme injection works (runtime)

1. `resolveDaisyThemeId(theme)` returns `horizon-gateway-light` or `horizon-gateway-dark` (custom themes follow `theme.base`, not `theme.id`).
2. `document.documentElement.setAttribute("data-theme", daisyThemeId)`.
3. `#custom-active-theme` injects variables into `:root` and `[data-theme="<daisyThemeId>"]`.
4. Injected declarations use `!important` to avoid DaisyUI 5 `@layer` specificity races between compiled and dynamic themes.
5. Injected vars include `--color-primary`, `*-content` pairs, `--color-base-100`–`300`, `--color-base-content`, `--font-sans`, and root `font-size`, `font-weight`, `line-height`.

### Default preset IDs

- Dark: `horizon-gateway-dark`
- Light: `horizon-gateway-light`

When editing typography in presets, update **both** default themes unless intentionally diverging.
## 6. Settings page checklist

When adding a new settings section:

1. Wrap in `<section className="space-y-2">`.
2. Put **title** in `<h2>` **above** `<Card>`.
3. Put **description** under H2, **outside** `<Card>`.
4. Put controls / data fields **only** inside the single `<Card>`.
5. Avoid bordered sub-panels inside the card; use grids, gaps, and field labels instead.
6. Use `space-y-6` between sections in the panel scroll area.
7. Use shared `Button`, `Input`, `Card` — do not invent local card styles with `border rounded-2xl shadow-sm`.

### Toggle-only sections (e.g. CORS)

Title outside, description outside card, toggle aligned `justify-end` inside card:

```tsx
<Section title={t.corsTitle} desc={t.corsDesc}>
  <div className="flex justify-end">
    <input type="checkbox" role="switch" className="toggle toggle-success toggle-sm" ... />
  </div>
</Section>
```

---

## 7. Panel stack (non-settings)

| Area | Convention |
|------|------------|
| Panel header | `px-3 py-2` — compact |
| Panel body | `p-3` |
| Panel icon | No background box; icon at `text-base-content/40` |
| TopBar search | `max-w-md` |

See `src/features/panel-stack/ui/Panel.tsx`, `TopBar.tsx`.

---

## 8. Inline code

Use theme tokens, not hardcoded colors:

```tsx
<code className="text-xs font-mono bg-base-200 p-2.5 rounded-md break-all text-primary/80">
```

---

## Quick reference

```
Section:     space-y-2  →  H2 + desc outside  →  Card (flat, one level, p-4–5)
Flat:        no bordered box inside Card; H3 labels + grid/fields only
Page:        p-5, space-y-6 / gap-6, max-w-3xl
Secondary:   text-base-content/55
Hints:       text-base-content/40
Labels:      text-[10px] font-medium text-base-content/50 (no uppercase)
Card:        variant="flat" default
Button:      secondary sm for settings actions
Input:       h-8 text-xs default
Theme:       13px / 1.4 via presets + applyThemeToDocument
```
