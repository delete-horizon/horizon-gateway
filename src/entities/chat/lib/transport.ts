import { commands, unwrap } from "@/shared/api";
import type { CommActionKind } from "../types";

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
  return unwrap(
    await commands.chatSendFrame(opts.lanHosts, opts.lanPort, opts.tunnelUrl, opts.frameJson),
  );
}

export async function playCommAction(kind: CommActionKind, seed?: number | null): Promise<void> {
  unwrap(await commands.playCommAction(kind, seed ?? null));
}

export async function clearCommOverlay(): Promise<void> {
  unwrap(await commands.clearCommOverlay());
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
