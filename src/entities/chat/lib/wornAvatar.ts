import { supabase } from "@/shared/api/supabase";
import { officialRef, type PartSlot, parsePartRef, userRef } from "../api/avatarOwnership";
import type { ChatPeerEndpoint } from "../types";
import type { AvatarKit } from "./avatarKit";
import { DEFAULT_AVATAR_KIT } from "./avatarKit";
import { installCommAvatarParts, sendChatFrame } from "./transport";

const USER_PART_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SLOTS: PartSlot[] = ["body", "head", "outfit", "back", "held"];

export const WORN_STORAGE_KEY = "horizon-gateway-worn-kit";
const PART_CACHE_KEY = "horizon-gateway-worn-parts";

export type WornRefs = Record<PartSlot, string>;

export type WornLook = {
  profileId: string;
  updatedAt: string;
  refs: WornRefs;
};

type CachedPart = {
  updatedAt: string;
  id: string;
  slot: string;
  ko: string;
  en: string;
  setKey: string;
  shop: boolean;
  glyphs: string[];
};

type WornPing = { profileId: string; phase: "announce" | "reply" };

let wornHandler: (ping: WornPing) => void = () => {};

export function setWornHandshakeHandler(fn: (ping: WornPing) => void): () => void {
  wornHandler = fn;
  return () => {
    wornHandler = () => {};
  };
}

export function noteWornPing(ping: WornPing): void {
  wornHandler(ping);
}

export function kitToRefs(kit: AvatarKit, userPartIds: ReadonlySet<string>): WornRefs {
  const refs = {} as WornRefs;
  for (const slot of SLOTS) {
    const id = kit[slot] || "none";
    refs[slot] = userPartIds.has(id) || USER_PART_ID.test(id) ? userRef(id) : officialRef(slot, id);
  }
  return refs;
}

export function refsToKit(refs: WornRefs): AvatarKit {
  const kit: AvatarKit = { ...DEFAULT_AVATAR_KIT };
  for (const slot of SLOTS) {
    const parsed = parsePartRef(refs[slot] ?? "");
    if (parsed) {
      kit[slot] = parsed.id;
    }
  }
  return kit;
}

export function defaultWornRefs(): WornRefs {
  return kitToRefs(DEFAULT_AVATAR_KIT, new Set());
}

export function readLocalWorn(): WornRefs {
  try {
    const raw = localStorage.getItem(WORN_STORAGE_KEY);
    if (!raw) {
      return defaultWornRefs();
    }
    const parsed = JSON.parse(raw) as Partial<WornRefs>;
    const fallback = defaultWornRefs();
    for (const slot of SLOTS) {
      if (typeof parsed[slot] !== "string" || !parsed[slot]) {
        parsed[slot] = fallback[slot];
      }
    }
    return parsed as WornRefs;
  } catch {
    return defaultWornRefs();
  }
}

export function writeLocalWorn(refs: WornRefs): void {
  localStorage.setItem(WORN_STORAGE_KEY, JSON.stringify(refs));
}

export async function publishWorn(refs: WornRefs): Promise<void> {
  writeLocalWorn(refs);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("로그인이 필요합니다");
  }
  const { error: upsertError } = await supabase.from("avatar_worn").upsert({
    profile_id: data.user.id,
    body_ref: refs.body,
    head_ref: refs.head,
    outfit_ref: refs.outfit,
    back_ref: refs.back,
    held_ref: refs.held,
    updated_at: new Date().toISOString(),
  });
  if (upsertError) {
    throw upsertError;
  }
}

export async function fetchWorn(profileIds: string[]): Promise<WornLook[]> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) {
    return [];
  }
  const { data, error } = await supabase.from("avatar_worn").select("*").in("profile_id", ids);
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    profileId: row.profile_id,
    updatedAt: row.updated_at,
    refs: {
      body: row.body_ref,
      head: row.head_ref,
      outfit: row.outfit_ref,
      back: row.back_ref,
      held: row.held_ref,
    },
  }));
}

function readPartCache(): Record<string, CachedPart> {
  try {
    const raw = localStorage.getItem(PART_CACHE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, CachedPart>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePartCache(cache: Record<string, CachedPart>): void {
  localStorage.setItem(PART_CACHE_KEY, JSON.stringify(cache));
}

function wornPartIds(looks: WornLook[]): string[] {
  const ids = new Set<string>();
  for (const look of looks) {
    for (const slot of SLOTS) {
      const parsed = parsePartRef(look.refs[slot]);
      if (parsed?.kind === "user") {
        ids.add(parsed.id);
      }
    }
  }
  return [...ids];
}

function studioPart(part: CachedPart): {
  id: string;
  slot: string;
  set: string;
  shop: boolean;
  ko: string;
  en: string;
  glyphs: string[];
} | null {
  if (part.glyphs.length !== 24 || part.glyphs.some((row) => [...row].length !== 24)) {
    return null;
  }
  return {
    id: part.id,
    slot: part.slot,
    set: part.setKey,
    shop: part.shop,
    ko: part.ko,
    en: part.en,
    glyphs: part.glyphs,
  };
}

async function resolveUserParts(ids: string[]): Promise<CachedPart[]> {
  if (ids.length === 0) {
    return [];
  }
  const cache = readPartCache();
  const { data: stamps, error } = await supabase.from("avatar_user_parts").select("id, updated_at").in("id", ids);
  if (error) {
    throw error;
  }
  const stale = (stamps ?? []).filter((row) => cache[row.id]?.updatedAt !== row.updated_at).map((row) => row.id);
  if (stale.length > 0) {
    const full = await supabase.from("avatar_user_parts").select("*").in("id", stale);
    if (full.error) {
      throw full.error;
    }
    for (const row of full.data ?? []) {
      const glyphs = Array.isArray(row.glyphs)
        ? row.glyphs.filter((line): line is string => typeof line === "string")
        : [];
      cache[row.id] = {
        updatedAt: row.updated_at,
        id: row.id,
        slot: row.slot,
        ko: row.ko,
        en: row.en,
        setKey: row.set_key,
        shop: row.shop,
        glyphs,
      };
    }
    writePartCache(cache);
  }
  return ids.map((id) => cache[id]).filter((part): part is CachedPart => Boolean(part));
}

/** Installs missing user glyphs, then returns a kit per profile. */
export async function kitsForWorn(looks: WornLook[]): Promise<Map<string, AvatarKit>> {
  try {
    const parts = await resolveUserParts(wornPartIds(looks));
    const studio = parts
      .map(studioPart)
      .filter((part): part is NonNullable<ReturnType<typeof studioPart>> => part !== null);
    if (studio.length > 0) {
      await installCommAvatarParts(studio);
    }
  } catch (error) {
    console.warn("worn parts", error);
  }
  return new Map(looks.map((look) => [look.profileId, refsToKit(look.refs)]));
}

export async function announceWorn(
  myId: string,
  peers: ChatPeerEndpoint[],
  phase: "announce" | "reply",
): Promise<void> {
  const frame = {
    v: 1 as const,
    id: crypto.randomUUID(),
    roomId: "worn",
    senderId: myId,
    kind: "worn" as const,
    ciphertext: JSON.stringify({ phase }),
    createdAt: new Date().toISOString(),
  };
  const frameJson = JSON.stringify(frame);
  await Promise.all(
    peers
      .filter((peer) => peer.profileId !== myId && peer.lanPort > 0)
      .map((peer) =>
        sendChatFrame({
          lanHosts: peer.lanHosts,
          lanPort: peer.lanPort,
          tunnelUrl: peer.tunnelUrl,
          frameJson,
        }).catch(() => {}),
      ),
  );
}
