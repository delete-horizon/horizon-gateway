import type { Json } from "@/shared/api/database.types";
import { supabase } from "@/shared/api/supabase";
import type { AvatarKit } from "../lib/avatarKit";
import { DEFAULT_AVATAR_KIT } from "../lib/avatarKit";

export type OwnedAvatar = {
  id: string;
  ownerId: string;
  nameKo: string;
  nameEn: string;
  bodyRef: string;
  headRef: string;
  outfitRef: string;
  backRef: string;
  heldRef: string;
  copiedFrom: string | null;
  visibility: "private" | "shared";
  listedForSale: boolean;
  revision: number;
};

export type UserPart = {
  id: string;
  ownerId: string;
  slot: string;
  slug: string;
  ko: string;
  en: string;
  setKey: string;
  shop: boolean;
  glyphs: string[];
  copiedFrom: string | null;
};

export type AvatarSnapshot = {
  revision: number;
  nameKo: string;
  nameEn: string;
  refs: Record<PartSlot, string>;
  parts: UserPart[];
};

export type PartSlot = "body" | "head" | "outfit" | "back" | "held";

const SLOTS: PartSlot[] = ["body", "head", "outfit", "back", "held"];

type OwnedRow = {
  id: string;
  owner_id: string;
  name_ko: string;
  name_en: string;
  body_ref: string;
  head_ref: string;
  outfit_ref: string;
  back_ref: string;
  held_ref: string;
  copied_from: string | null;
  visibility: string;
  listed_for_sale: boolean;
  revision: number;
};

type PartRow = {
  id: string;
  owner_id: string;
  slot: string;
  slug: string;
  ko: string;
  en: string;
  set_key: string;
  shop: boolean;
  glyphs: Json;
  copied_from: string | null;
};

export function officialRef(slot: string, id: string): string {
  return `official:${slot}:${id}`;
}

export function userRef(id: string): string {
  return `user:${id}`;
}

export function parsePartRef(
  ref: string,
): { kind: "official"; slot: string; id: string } | { kind: "user"; id: string } | null {
  if (ref.startsWith("user:")) {
    return { kind: "user", id: ref.slice(5) };
  }
  if (ref.startsWith("official:")) {
    const rest = ref.slice("official:".length);
    const split = rest.indexOf(":");
    if (split <= 0) {
      return null;
    }
    return { kind: "official", slot: rest.slice(0, split), id: rest.slice(split + 1) };
  }
  return null;
}

function refsOf(row: OwnedRow): Record<PartSlot, string> {
  return {
    body: row.body_ref,
    head: row.head_ref,
    outfit: row.outfit_ref,
    back: row.back_ref,
    held: row.held_ref,
  };
}

function mapOwned(row: OwnedRow): OwnedAvatar {
  return {
    id: row.id,
    ownerId: row.owner_id,
    nameKo: row.name_ko,
    nameEn: row.name_en,
    bodyRef: row.body_ref,
    headRef: row.head_ref,
    outfitRef: row.outfit_ref,
    backRef: row.back_ref,
    heldRef: row.held_ref,
    copiedFrom: row.copied_from,
    visibility: row.visibility === "shared" ? "shared" : "private",
    listedForSale: row.listed_for_sale,
    revision: row.revision,
  };
}

function mapPart(row: PartRow): UserPart {
  const glyphs = Array.isArray(row.glyphs) ? row.glyphs.filter((line): line is string => typeof line === "string") : [];
  return {
    id: row.id,
    ownerId: row.owner_id,
    slot: row.slot,
    slug: row.slug,
    ko: row.ko,
    en: row.en,
    setKey: row.set_key,
    shop: row.shop,
    glyphs,
    copiedFrom: row.copied_from,
  };
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("로그인이 필요합니다");
  }
  return data.user.id;
}

function kitRefs(kit: AvatarKit): Record<PartSlot, string> {
  return {
    body: officialRef("body", kit.body),
    head: officialRef("head", kit.head),
    outfit: officialRef("outfit", kit.outfit),
    back: officialRef("back", kit.back),
    held: officialRef("held", kit.held),
  };
}

export function ownedToKit(avatar: OwnedAvatar, parts: UserPart[]): AvatarKit {
  const refs = {
    body: avatar.bodyRef,
    head: avatar.headRef,
    outfit: avatar.outfitRef,
    back: avatar.backRef,
    held: avatar.heldRef,
  };
  const kit: AvatarKit = { ...DEFAULT_AVATAR_KIT };
  for (const slot of SLOTS) {
    const parsed = parsePartRef(refs[slot]);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === "official") {
      kit[slot] = parsed.id;
      continue;
    }
    const part = parts.find((item) => item.id === parsed.id);
    kit[slot] = part?.id ?? parsed.id;
  }
  return kit;
}

export async function listMyAvatars(): Promise<OwnedAvatar[]> {
  const ownerId = await requireUserId();
  const { data, error } = await supabase
    .from("avatar_owned")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) {
    throw error;
  }
  return ((data ?? []) as OwnedRow[]).map(mapOwned);
}

export async function listSharedAvatars(): Promise<OwnedAvatar[]> {
  const { data, error } = await supabase
    .from("avatar_owned")
    .select("*")
    .eq("visibility", "shared")
    .order("updated_at", { ascending: false });
  if (error) {
    throw error;
  }
  return ((data ?? []) as OwnedRow[]).map(mapOwned);
}

export async function listMyEntitlements(): Promise<
  Array<{ avatarId: string; revision: number; snapshot: AvatarSnapshot }>
> {
  const buyerId = await requireUserId();
  const { data, error } = await supabase.from("avatar_entitlements").select("*").eq("buyer_id", buyerId);
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    avatarId: row.avatar_id,
    revision: row.revision,
    snapshot: row.snapshot as AvatarSnapshot,
  }));
}

export async function loadParts(ids: string[]): Promise<UserPart[]> {
  if (ids.length === 0) {
    return [];
  }
  const { data, error } = await supabase.from("avatar_user_parts").select("*").in("id", ids);
  if (error) {
    throw error;
  }
  return ((data ?? []) as PartRow[]).map(mapPart);
}

export function userPartIds(avatar: OwnedAvatar): string[] {
  return SLOTS.flatMap((slot) => {
    const ref = avatar[`${slot}Ref`];
    const parsed = parsePartRef(ref);
    return parsed?.kind === "user" ? [parsed.id] : [];
  });
}

export async function authorName(ownerId: string): Promise<string> {
  const { data, error } = await supabase.rpc("avatar_author_name", { target: ownerId });
  if (error || !data) {
    return "회원";
  }
  return data;
}

async function insertPart(ownerId: string, part: Omit<UserPart, "id" | "ownerId">): Promise<UserPart> {
  const { data, error } = await supabase
    .from("avatar_user_parts")
    .insert({
      owner_id: ownerId,
      slot: part.slot,
      slug: part.slug,
      ko: part.ko,
      en: part.en,
      set_key: part.setKey,
      shop: part.shop,
      glyphs: part.glyphs,
      copied_from: part.copiedFrom,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) {
    throw error ?? new Error("파츠를 저장하지 못했습니다");
  }
  return mapPart(data as PartRow);
}

async function readOwned(id: string): Promise<OwnedRow> {
  const { data, error } = await supabase.from("avatar_owned").select("*").eq("id", id).single();
  if (error || !data) {
    throw error ?? new Error("아바타를 찾지 못했습니다");
  }
  return data as OwnedRow;
}

export async function copyOfficialKit(kit: AvatarKit, nameKo: string, nameEn: string): Promise<OwnedAvatar> {
  const ownerId = await requireUserId();
  const refs = kitRefs(kit);
  const { data, error } = await supabase
    .from("avatar_owned")
    .insert({
      owner_id: ownerId,
      name_ko: nameKo,
      name_en: nameEn,
      body_ref: refs.body,
      head_ref: refs.head,
      outfit_ref: refs.outfit,
      back_ref: refs.back,
      held_ref: refs.held,
      copied_from: "official",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) {
    throw error ?? new Error("복사하지 못했습니다");
  }
  return mapOwned(data as OwnedRow);
}

export async function copyOwnedAvatar(avatarId: string): Promise<OwnedAvatar> {
  const ownerId = await requireUserId();
  const source = await readOwned(avatarId);
  if (source.owner_id !== ownerId) {
    throw new Error("다른 사람의 아바타는 복사할 수 없습니다");
  }
  const sourceParts = await loadParts(
    SLOTS.flatMap((slot) => {
      const parsed = parsePartRef(refsOf(source)[slot]);
      return parsed?.kind === "user" ? [parsed.id] : [];
    }),
  );
  const refMap = new Map<string, string>();
  for (const part of sourceParts) {
    const cloned = await insertPart(ownerId, {
      ...part,
      copiedFrom: userRef(part.id),
    });
    refMap.set(part.id, cloned.id);
  }
  const remap = (ref: string) => {
    const parsed = parsePartRef(ref);
    if (parsed?.kind === "user") {
      const next = refMap.get(parsed.id);
      return next ? userRef(next) : ref;
    }
    return ref;
  };
  const { data, error } = await supabase
    .from("avatar_owned")
    .insert({
      owner_id: ownerId,
      name_ko: `${source.name_ko} 복사`,
      name_en: `${source.name_en} copy`,
      body_ref: remap(source.body_ref),
      head_ref: remap(source.head_ref),
      outfit_ref: remap(source.outfit_ref),
      back_ref: remap(source.back_ref),
      held_ref: remap(source.held_ref),
      copied_from: source.id,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) {
    throw error ?? new Error("복사하지 못했습니다");
  }
  return mapOwned(data as OwnedRow);
}

export async function forkSlot(
  avatarId: string,
  slot: PartSlot,
  part: { slug: string; ko: string; en: string; setKey: string; shop: boolean; glyphs: string[] },
): Promise<OwnedAvatar> {
  const ownerId = await requireUserId();
  const source = await readOwned(avatarId);
  if (source.owner_id !== ownerId) {
    throw new Error("다른 사람의 아바타는 편집할 수 없습니다");
  }
  const current = refsOf(source)[slot];
  const created = await insertPart(ownerId, {
    slot,
    slug: part.slug,
    ko: part.ko,
    en: part.en,
    setKey: part.setKey,
    shop: part.shop,
    glyphs: part.glyphs,
    copiedFrom: current,
  });
  const columnPatch = {
    body: { body_ref: userRef(created.id) },
    head: { head_ref: userRef(created.id) },
    outfit: { outfit_ref: userRef(created.id) },
    back: { back_ref: userRef(created.id) },
    held: { held_ref: userRef(created.id) },
  }[slot];
  const { data, error } = await supabase
    .from("avatar_owned")
    .update({
      ...columnPatch,
      revision: source.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", avatarId)
    .select("*")
    .single();
  if (error || !data) {
    throw error ?? new Error("슬롯을 저장하지 못했습니다");
  }
  return mapOwned(data as OwnedRow);
}

export async function setVisibility(avatarId: string, visibility: "private" | "shared"): Promise<void> {
  const ownerId = await requireUserId();
  const patch: { visibility: "private" | "shared"; listed_for_sale?: boolean; updated_at: string } = {
    visibility,
    updated_at: new Date().toISOString(),
  };
  if (visibility === "private") {
    patch.listed_for_sale = false;
  }
  const { error } = await supabase.from("avatar_owned").update(patch).eq("id", avatarId).eq("owner_id", ownerId);
  if (error) {
    throw error;
  }
}

export async function setListedForSale(avatarId: string, listed: boolean): Promise<void> {
  const ownerId = await requireUserId();
  const patch: { listed_for_sale: boolean; visibility?: "shared"; updated_at: string } = {
    listed_for_sale: listed,
    updated_at: new Date().toISOString(),
  };
  if (listed) {
    patch.visibility = "shared";
  }
  const { error } = await supabase.from("avatar_owned").update(patch).eq("id", avatarId).eq("owner_id", ownerId);
  if (error) {
    throw error;
  }
}

async function snapshotOf(row: OwnedRow): Promise<AvatarSnapshot> {
  const ids = SLOTS.flatMap((slot) => {
    const parsed = parsePartRef(refsOf(row)[slot]);
    return parsed?.kind === "user" ? [parsed.id] : [];
  });
  const parts = await loadParts(ids);
  return {
    revision: row.revision,
    nameKo: row.name_ko,
    nameEn: row.name_en,
    refs: refsOf(row),
    parts,
  };
}

export async function purchaseAvatar(avatarId: string): Promise<void> {
  const buyerId = await requireUserId();
  const row = await readOwned(avatarId);
  if (row.owner_id === buyerId) {
    throw new Error("내 아바타는 구매할 수 없습니다");
  }
  if (!row.listed_for_sale) {
    throw new Error("판매 중인 아바타만 구매할 수 있습니다");
  }
  const snapshot = await snapshotOf(row);
  const { error } = await supabase.from("avatar_entitlements").insert({
    avatar_id: avatarId,
    buyer_id: buyerId,
    revision: row.revision,
    snapshot: snapshot as unknown as Json,
  });
  if (error) {
    throw error;
  }
}

export async function pushAvatarUpdate(avatarId: string): Promise<void> {
  const ownerId = await requireUserId();
  const row = await readOwned(avatarId);
  if (row.owner_id !== ownerId) {
    throw new Error("소유자만 구매분을 갱신할 수 있습니다");
  }
  const nextRevision = row.revision + 1;
  const { error: bumpError } = await supabase
    .from("avatar_owned")
    .update({ revision: nextRevision, updated_at: new Date().toISOString() })
    .eq("id", avatarId);
  if (bumpError) {
    throw bumpError;
  }
  const snapshot = await snapshotOf({ ...row, revision: nextRevision });
  const { error } = await supabase
    .from("avatar_entitlements")
    .update({ revision: nextRevision, snapshot: snapshot as unknown as Json })
    .eq("avatar_id", avatarId);
  if (error) {
    throw error;
  }
}
