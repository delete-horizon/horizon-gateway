export const AVATAR_GRID = 24;
export const AVATAR_PAD_TOP = 4;
export const AVATAR_COMPOSE_H = AVATAR_GRID + AVATAR_PAD_TOP;

export const GLYPH_CHANNELS = [
  { ch: ".", ko: "비움", en: "Empty", hex: null },
  { ch: "O", ko: "외곽", en: "Outline", hex: "#1c122c" },
  { ch: "S", ko: "피부", en: "Skin", hex: "#e8c4a8" },
  { ch: "D", ko: "그림자", en: "Skin shadow", hex: "#b48470" },
  { ch: "C", ko: "옷", en: "Cloth", hex: "#584094" },
  { ch: "K", ko: "옷 그림자", en: "Cloth shadow", hex: "#30205c" },
  { ch: "A", ko: "포인트", en: "Accent", hex: "#b48cff" },
  { ch: "M", ko: "금속", en: "Metal", hex: "#bcb0dc" },
  { ch: "E", ko: "눈", en: "Eye", hex: "#1c1628" },
  { ch: "W", ko: "하이라이트", en: "White", hex: "#faf6ff" },
] as const;

export type GlyphCh = (typeof GLYPH_CHANNELS)[number]["ch"];

export type AvatarRig = {
  crown: [number, number];
  face: [number, number];
  torso: [number, number];
  hand: [number, number];
};

const HUMAN_RIG: AvatarRig = {
  crown: [12, 3],
  face: [12, 7],
  torso: [12, 14],
  hand: [16, 15],
};

export type PartChroma = {
  outline?: number[];
  skin?: number[];
  skinD?: number[];
  cloth?: number[];
  clothD?: number[];
  accent?: number[];
  metal?: number[];
  eye?: number[];
  white?: number[];
};

const DEFAULT_CHROMA: Required<{
  outline: number[];
  skin: number[];
  skinD: number[];
  cloth: number[];
  clothD: number[];
  accent: number[];
  metal: number[];
  eye: number[];
  white: number[];
}> = {
  outline: [28, 18, 44],
  skin: [232, 196, 168],
  skinD: [180, 132, 112],
  cloth: [88, 64, 148],
  clothD: [48, 32, 92],
  accent: [180, 140, 255],
  metal: [188, 176, 220],
  eye: [28, 22, 40],
  white: [250, 246, 255],
};

export type StudioPart = {
  id: string;
  slot: string;
  set?: string;
  shop: boolean;
  ko: string;
  en: string;
  glyphs: string[];
  group?: string;
  scale?: number;
  rig?: AvatarRig | null;
  attach?: string;
  seat?: [number, number] | null;
  fits?: string[];
  chroma?: PartChroma | null;
};

export type StudioPalette = {
  id: string;
  ko: string;
  en: string;
  shop: boolean;
  outline: number[];
  skin: number[];
  skinD: number[];
  cloth: number[];
  clothD: number[];
  accent: number[];
  metal: number[];
  eye: number[];
  white: number[];
};

export type StudioSet = {
  id: string;
  ko: string;
  en: string;
  shop: boolean;
  kit: {
    body: string;
    head: string;
    outfit: string;
    back: string;
    held: string;
  };
  chroma?: PartChroma | null;
};

export type StudioGroup = {
  id: string;
  grid: number;
  referenceBody: string;
  ko: string;
  en: string;
};

export type StudioCatalog = {
  parts: StudioPart[];
  sets?: StudioSet[];
  groups?: StudioGroup[];
  warnings?: string[];
};

export function emptyGlyphs(): string[] {
  return Array.from({ length: AVATAR_GRID }, () => ".".repeat(AVATAR_GRID));
}

export function setGlyphCell(glyphs: string[], x: number, y: number, ch: string): string[] {
  if (x < 0 || y < 0 || x >= AVATAR_GRID || y >= AVATAR_GRID) {
    return glyphs;
  }
  const next = glyphs.slice();
  const row = next[y]?.split("") ?? ".".repeat(AVATAR_GRID).split("");
  row[x] = ch;
  next[y] = row.join("");
  return next;
}

function chRgb(pal: StudioPalette, ch: string): number[] | null {
  switch (ch) {
    case "O":
      return pal.outline;
    case "S":
      return pal.skin;
    case "D":
      return pal.skinD;
    case "C":
      return pal.cloth;
    case "K":
      return pal.clothD;
    case "A":
      return pal.accent;
    case "M":
      return pal.metal;
    case "E":
      return pal.eye;
    case "W":
      return pal.white;
    default:
      return null;
  }
}

function layerPalette(catalog: StudioCatalog, part: StudioPart | undefined): StudioPalette {
  const c = part?.chroma;
  const setChroma = part?.set && catalog.sets ? catalog.sets.find((s) => s.id === part.set)?.chroma : undefined;
  const pick = (key: keyof PartChroma, fallback: number[]) => c?.[key] ?? setChroma?.[key] ?? fallback;
  return {
    id: "part",
    ko: "",
    en: "",
    shop: false,
    outline: pick("outline", DEFAULT_CHROMA.outline),
    skin: pick("skin", DEFAULT_CHROMA.skin),
    skinD: pick("skinD", DEFAULT_CHROMA.skinD),
    cloth: pick("cloth", DEFAULT_CHROMA.cloth),
    clothD: pick("clothD", DEFAULT_CHROMA.clothD),
    accent: pick("accent", DEFAULT_CHROMA.accent),
    metal: pick("metal", DEFAULT_CHROMA.metal),
    eye: pick("eye", DEFAULT_CHROMA.eye),
    white: pick("white", DEFAULT_CHROMA.white),
  };
}

function paintGlyphs(
  buf: Uint8ClampedArray,
  glyphs: string[],
  pal: StudioPalette,
  dx: number,
  dy: number,
  width: number,
  height: number,
) {
  for (let y = 0; y < glyphs.length; y++) {
    const row = glyphs[y];
    for (let x = 0; x < row.length; x++) {
      const rgb = chRgb(pal, row[x] ?? ".");
      if (!rgb) {
        continue;
      }
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) {
        continue;
      }
      const i = (py * width + px) * 4;
      buf[i] = rgb[0] ?? 0;
      buf[i + 1] = rgb[1] ?? 0;
      buf[i + 2] = rgb[2] ?? 0;
      buf[i + 3] = 255;
    }
  }
}

function inferSeat(glyphs: string[]): [number, number] {
  for (let y = AVATAR_GRID - 1; y >= 0; y--) {
    const row = glyphs[y] ?? "";
    const xs: number[] = [];
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== ".") {
        xs.push(x);
      }
    }
    if (xs.length > 0) {
      return [Math.floor((xs[0] + xs[xs.length - 1]) / 2), y];
    }
  }
  return [12, 6];
}

function partOf(catalog: StudioCatalog, slot: string, id: string): StudioPart | undefined {
  if (!id || id === "none") {
    return undefined;
  }
  return catalog.parts.find((p) => p.slot === slot && p.id === id);
}

function bodyMeta(catalog: StudioCatalog, bodyId: string): { group: string; rig: AvatarRig } {
  const body = partOf(catalog, "body", bodyId);
  return {
    group: body?.group?.trim() || "humanoid",
    rig: body?.rig ?? HUMAN_RIG,
  };
}

function refRig(catalog: StudioCatalog, group: string): AvatarRig {
  const refBody =
    catalog.groups?.find((g) => g.id === group)?.referenceBody || (group === "humanoid" ? "human" : "human");
  return partOf(catalog, "body", refBody)?.rig ?? HUMAN_RIG;
}

function fitsGroup(part: StudioPart, group: string): boolean {
  if (!part.fits || part.fits.length === 0) {
    return true;
  }
  return part.fits.includes(group) || part.fits.includes("*");
}

export function composeStudioRgba(
  kit: { body: string; head: string; outfit: string; back: string; held: string },
  catalog: StudioCatalog,
  step: number,
  draft?: { slot: string; glyphs: string[] },
): Uint8ClampedArray {
  const width = AVATAR_GRID;
  const height = AVATAR_COMPOSE_H;
  const buf = new Uint8ClampedArray(width * height * 4);
  const { group, rig } = bodyMeta(catalog, kit.body);
  const reference = refRig(catalog, group);
  const base = AVATAR_PAD_TOP;
  const foot = step % 2 === 1 ? -1 : 0;
  const torsoDx = rig.torso[0] - reference.torso[0];
  const torsoDy = rig.torso[1] - reference.torso[1];
  const faceDx = rig.face[0] - reference.face[0];
  const faceDy = rig.face[1] - reference.face[1];
  const handDx = rig.hand[0] - reference.hand[0];
  const handDy = rig.hand[1] - reference.hand[1];

  const layer = (slot: string): StudioPart | undefined => {
    if (draft?.slot === slot) {
      const basePart = partOf(catalog, slot, kit[slot as keyof typeof kit] as string);
      return {
        id: kit[slot as keyof typeof kit] as string,
        slot,
        shop: false,
        ko: "",
        en: "",
        glyphs: draft.glyphs,
        set: basePart?.set,
        attach: basePart?.attach,
        seat: basePart?.seat,
        fits: basePart?.fits,
        rig: basePart?.rig,
        group: basePart?.group,
        chroma: basePart?.chroma,
      };
    }
    return partOf(catalog, slot, kit[slot as keyof typeof kit] as string);
  };

  const back = layer("back");
  if (back && fitsGroup(back, group)) {
    paintGlyphs(buf, back.glyphs, layerPalette(catalog, back), torsoDx, base + torsoDy, width, height);
  }
  const body = layer("body");
  if (body) {
    paintGlyphs(buf, body.glyphs, layerPalette(catalog, body), 0, base + foot, width, height);
  }
  const outfit = layer("outfit");
  if (outfit && fitsGroup(outfit, group)) {
    paintGlyphs(buf, outfit.glyphs, layerPalette(catalog, outfit), torsoDx, base + torsoDy + foot, width, height);
  }
  const head = layer("head");
  if (head && fitsGroup(head, group)) {
    const attach = (head.attach ?? "").toLowerCase();
    let dx = torsoDx;
    let dy = base + torsoDy;
    if (attach === "perch") {
      const seat = head.seat ?? inferSeat(head.glyphs);
      dx = rig.crown[0] - seat[0];
      dy = base + rig.crown[1] - seat[1];
    } else if (attach === "cover") {
      dx = faceDx;
      dy = base + faceDy;
    }
    paintGlyphs(buf, head.glyphs, layerPalette(catalog, head), dx, dy, width, height);
  }
  const held = layer("held");
  if (held && fitsGroup(held, group)) {
    paintGlyphs(buf, held.glyphs, layerPalette(catalog, held), handDx, base + handDy, width, height);
  }
  return buf;
}

export function blitRgba(canvas: HTMLCanvasElement, rgba: Uint8ClampedArray, scale: number) {
  const width = AVATAR_GRID;
  const height = rgba.length / (width * 4);
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  src.getContext("2d")?.putImageData(new ImageData(rgba, width, height), 0, 0);
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
}

export function drawGlyphGrid(canvas: HTMLCanvasElement, glyphs: string[], cell: number) {
  const size = AVATAR_GRID * cell;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < AVATAR_GRID; y++) {
    const row = glyphs[y] ?? "";
    for (let x = 0; x < AVATAR_GRID; x++) {
      const ch = row[x] ?? ".";
      const spec = GLYPH_CHANNELS.find((g) => g.ch === ch);
      const dx = x * cell;
      const dy = y * cell;
      if (!spec?.hex) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#1a1624" : "#2a2438";
        ctx.fillRect(dx, dy, cell, cell);
        continue;
      }
      ctx.fillStyle = spec.hex;
      ctx.fillRect(dx, dy, cell, cell);
    }
  }
}
