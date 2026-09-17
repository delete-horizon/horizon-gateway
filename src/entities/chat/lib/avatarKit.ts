export type AvatarKit = {
  body: string;
  head: string;
  outfit: string;
  back: string;
  held: string;
  palette: string;
};

export const DEFAULT_AVATAR_KIT: AvatarKit = {
  body: "sprite",
  head: "none",
  outfit: "cloak",
  back: "none",
  held: "staff",
  palette: "dusk",
};

export const FRIEND_AVATAR_KIT: AvatarKit = {
  body: "imp",
  head: "horns",
  outfit: "cloak",
  back: "cape",
  held: "lantern",
  palette: "ember",
};

export type AvatarSlot = keyof AvatarKit;

export type AvatarPartOption = {
  id: string;
  ko: string;
  en: string;
  /** Previewable now; billed later. */
  shop?: boolean;
};

const SLOT_META: Record<AvatarSlot, { ko: string; en: string }> = {
  body: { ko: "종족", en: "Body" },
  head: { ko: "머리", en: "Head" },
  outfit: { ko: "옷", en: "Outfit" },
  back: { ko: "등", en: "Back" },
  held: { ko: "손", en: "Held" },
  palette: { ko: "팔레트", en: "Palette" },
};

const OPTIONAL_SLOTS: AvatarSlot[] = ["head", "outfit", "back", "held"];

export function applyAvatarSet(kit: AvatarKit, setKit: Partial<AvatarKit> | undefined): AvatarKit {
  return {
    body: setKit?.body?.trim() || kit.body,
    head: setKit?.head?.trim() || kit.head,
    outfit: setKit?.outfit?.trim() || kit.outfit,
    back: setKit?.back?.trim() || kit.back,
    held: setKit?.held?.trim() || kit.held,
    palette: setKit?.palette?.trim() || kit.palette,
  };
}

export function slotsFromStudioCatalog(catalog: {
  parts: { id: string; slot: string; shop: boolean; ko: string; en: string }[];
  palettes: { id: string; shop: boolean; ko: string; en: string }[];
}): { slot: AvatarSlot; ko: string; en: string; options: AvatarPartOption[] }[] {
  return (Object.keys(SLOT_META) as AvatarSlot[]).map((slot) => {
    const meta = SLOT_META[slot];
    if (slot === "palette") {
      return {
        slot,
        ...meta,
        options: catalog.palettes.map((p) => ({ id: p.id, ko: p.ko, en: p.en, shop: p.shop })),
      };
    }
    const options: AvatarPartOption[] = catalog.parts
      .filter((p) => p.slot === slot)
      .map((p) => ({ id: p.id, ko: p.ko, en: p.en, shop: p.shop }));
    if (OPTIONAL_SLOTS.includes(slot)) {
      options.unshift({ id: "none", ko: "없음", en: "None" });
    }
    return { slot, ...meta, options };
  });
}

export const AVATAR_CATALOG: { slot: AvatarSlot; ko: string; en: string; options: AvatarPartOption[] }[] = [
  {
    slot: "body",
    ko: "종족",
    en: "Body",
    options: [
      { id: "sprite", ko: "스프라이트", en: "Sprite" },
      { id: "imp", ko: "임프", en: "Imp" },
      { id: "golem", ko: "골렘", en: "Golem", shop: true },
    ],
  },
  {
    slot: "head",
    ko: "머리",
    en: "Head",
    options: [
      { id: "none", ko: "없음", en: "None" },
      { id: "horns", ko: "뿔", en: "Horns" },
      { id: "hood", ko: "후드", en: "Hood" },
      { id: "crown", ko: "왕관", en: "Crown", shop: true },
    ],
  },
  {
    slot: "outfit",
    ko: "옷",
    en: "Outfit",
    options: [
      { id: "none", ko: "없음", en: "None" },
      { id: "cloak", ko: "망토", en: "Cloak" },
      { id: "robe", ko: "로브", en: "Robe" },
      { id: "mail", ko: "갑옷", en: "Mail", shop: true },
    ],
  },
  {
    slot: "back",
    ko: "등",
    en: "Back",
    options: [
      { id: "none", ko: "없음", en: "None" },
      { id: "cape", ko: "케이프", en: "Cape" },
      { id: "wings", ko: "날개", en: "Wings", shop: true },
    ],
  },
  {
    slot: "held",
    ko: "손",
    en: "Held",
    options: [
      { id: "none", ko: "없음", en: "None" },
      { id: "staff", ko: "지팡이", en: "Staff" },
      { id: "lantern", ko: "랜턴", en: "Lantern" },
      { id: "blade", ko: "검", en: "Blade", shop: true },
    ],
  },
  {
    slot: "palette",
    ko: "팔레트",
    en: "Palette",
    options: [
      { id: "dusk", ko: "황혼", en: "Dusk" },
      { id: "ember", ko: "불씨", en: "Ember" },
      { id: "moss", ko: "이끼", en: "Moss" },
      { id: "ice", ko: "서리", en: "Ice", shop: true },
    ],
  },
];
