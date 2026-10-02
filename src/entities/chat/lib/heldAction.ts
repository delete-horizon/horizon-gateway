import type { AvatarStudioCatalog, HeldAction } from "@/shared/api";
import type { CommActionKind } from "../types";

const OVERLAYS: readonly CommActionKind[] = [
  "poke",
  "slash",
  "thrust",
  "blunt",
  "shot",
  "cast",
  "guard",
  "light",
  "sparkle",
  "ping",
  "float",
  "burst",
  "wave",
  "coffee_ask",
  "coffee_give",
  "fly",
];

export type ResolvedHeldAction = {
  id: string;
  ko: string;
  en: string;
  overlay: CommActionKind;
};

function asOverlay(value: string): CommActionKind {
  return OVERLAYS.includes(value as CommActionKind) ? (value as CommActionKind) : "poke";
}

function fromRow(action: HeldAction | undefined, fallback: ResolvedHeldAction): ResolvedHeldAction {
  if (!action) {
    return fallback;
  }
  return {
    id: action.id,
    ko: action.ko,
    en: action.en,
    overlay: asOverlay(action.overlay),
  };
}

/** One action for the equipped hand part. Unknown kinds use the unarmed row. */
export function resolveHeldAction(catalog: AvatarStudioCatalog | null, heldId: string): ResolvedHeldAction {
  const actions = catalog?.heldActions ?? [];
  const unarmed = fromRow(
    actions.find((action) => action.id === "poke"),
    { id: "poke", ko: "찌르기", en: "Poke", overlay: "poke" },
  );
  if (!catalog || !heldId || heldId === "none") {
    return unarmed;
  }
  const part = catalog.parts.find((item) => item.slot === "held" && item.id === heldId);
  const match = actions.find((action) => action.id === part?.weaponKind);
  return fromRow(match, unarmed);
}
