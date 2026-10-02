import { commands, unwrap } from "@/shared/api";
import type { CommActionKind } from "../types";
import type { AvatarKit } from "./avatarKit";

export interface ChatPeerListenInfo {
  port: number;
  lanHosts: string[];
}

export interface ChatSendResult {
  state: string;
  via: "lan" | "tunnel" | "none" | string;
}

export async function startChatListener(): Promise<ChatPeerListenInfo> {
  return unwrap(await commands.chatStartListener());
}

export async function stopChatListener(): Promise<void> {
  unwrap(await commands.chatStopListener());
}

export async function sendChatFrame(opts: {
  lanHosts: string[];
  lanPort: number;
  tunnelUrl: string | null;
  frameJson: string;
}): Promise<ChatSendResult> {
  return unwrap(await commands.chatSendFrame(opts.lanHosts, opts.lanPort, opts.tunnelUrl, opts.frameJson));
}

export async function playCommAction(
  kind: CommActionKind,
  seed?: number | null,
  count?: number | null,
  fromLabel?: string | null,
  anchorId?: string | null,
  attackerId?: string | null,
): Promise<void> {
  unwrap(
    await commands.playCommAction(
      kind,
      seed ?? null,
      count ?? null,
      fromLabel ?? null,
      anchorId ?? null,
      attackerId ?? null,
    ),
  );
}

export async function setCommOverlayTool(tool: "none" | "spray"): Promise<void> {
  unwrap(await commands.setCommOverlayTool(tool));
}

export async function clearCommOverlay(): Promise<void> {
  unwrap(await commands.clearCommOverlay());
}

export async function syncCommResidents(
  residents: { profileId: string; label: string; online: boolean; kit?: AvatarKit }[],
): Promise<void> {
  unwrap(await commands.syncCommResidents(residents));
}

export async function showCommBubble(profileId: string, text: string, ttlMs?: number | null): Promise<void> {
  unwrap(await commands.showCommBubble(profileId, text, ttlMs ?? null));
}

/** Ask every open shell to draw this line on `profileId`. The workspace shell owns the sprites. */
export async function broadcastOwnBubble(profileId: string, text: string): Promise<void> {
  unwrap(await commands.broadcastCommBubble(profileId, text));
}

export async function installCommAvatarParts(
  parts: Parameters<typeof commands.installCommAvatarParts>[0],
): Promise<void> {
  unwrap(await commands.installCommAvatarParts(parts));
}

export async function getCommAvatarCatalog() {
  return unwrap(await commands.getCommAvatarCatalog());
}

export async function reloadCommAvatarCatalog() {
  return unwrap(await commands.reloadCommAvatarCatalog());
}

export async function composeCommAvatar(kit: AvatarKit, step?: number | null) {
  return unwrap(await commands.composeCommAvatar(kit, step ?? null));
}

export async function writeCommAvatarPart(part: {
  id: string;
  slot: string;
  set?: string;
  shop: boolean;
  ko: string;
  en: string;
  glyphs: string[];
}): Promise<string> {
  return unwrap(
    await commands.writeCommAvatarPart({
      id: part.id,
      slot: part.slot,
      set: part.set ?? "",
      shop: part.shop,
      ko: part.ko,
      en: part.en,
      glyphs: part.glyphs,
    }),
  );
}

/** Optional: start cloudflare tunnel and return public URL for chat port forwarding hint. */
export async function tryStartTunnel(): Promise<string | null> {
  try {
    const res = await commands.startCloudflareTunnel();
    if (res.status === "ok" && res.data.success) {
      return res.data.data;
    }
  } catch {
    /* tunnel optional */
  }
  return null;
}

export async function getTailscaleIp(): Promise<string | null> {
  try {
    const res = await commands.getTailscaleIp();
    if (res.status === "ok" && res.data.success) {
      return res.data.data;
    }
  } catch {
    /* optional */
  }
  return null;
}
