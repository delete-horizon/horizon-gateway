import {
  listChatRoomMeta,
  listDeviceKeys,
  listPeerSessions,
  peerSessionToEndpoint,
  upsertChatRoomMeta,
  upsertDeviceKey,
  upsertPeerSession,
} from "../api/signaling";
import type { ChatMessage, ChatPeerEndpoint, ChatRoom, CommActionKind } from "../types";
import {
  deriveDmRoomKey,
  ensureChatIdentity,
  generateGroupRoomKey,
  openChatPayload,
  sealChatPayload,
  wrapRoomKey,
} from "./crypto";
import {
  appendLocalMessage,
  bumpUnread,
  dmRoomId,
  enqueueOutbox,
  getLocalRoom,
  listLocalMessages,
  listLocalRooms,
  listOutbox,
  markRoomRead,
  removeOutbox,
  upsertLocalRoom,
} from "./localStore";
import { notifyIncomingChat } from "./notify";
import { getTailscaleIp, playCommAction, sendChatFrame, startChatListener, tryStartTunnel } from "./transport";

export interface ChatWireFrame {
  v: 1;
  id: string;
  roomId: string;
  senderId: string;
  kind: "text" | "system" | "action";
  ciphertext: string;
  actionKind?: CommActionKind;
  /** How many overlays to spawn (flies). Defaults to 1. */
  actionCount?: number;
  /** Display name at send time — overlay label on receiver. */
  senderLabel?: string;
  createdAt: string;
}

const roomKeys = new Map<string, string>();

function uuid(): string {
  return crypto.randomUUID();
}

export async function bootstrapChatIdentity(profileId: string): Promise<{ deviceId: string; publicKey: string }> {
  const id = await ensureChatIdentity();
  await upsertDeviceKey({
    profileId,
    deviceId: id.deviceId,
    x25519Public: id.publicKey,
  });
  return id;
}

export type ChatPeerListenInfo = Awaited<ReturnType<typeof startChatListener>>;

export async function announcePresence(opts: {
  workspaceId: string;
  profileId: string;
  isHost: boolean;
}): Promise<ChatPeerListenInfo & { tunnelUrl: string | null }> {
  const identity = await bootstrapChatIdentity(opts.profileId);
  const listenInfo = await startChatListener();
  const tailscale = await getTailscaleIp();
  const lanHosts = [...listenInfo.lanHosts];
  if (tailscale && !lanHosts.includes(tailscale)) {
    lanHosts.push(tailscale);
  }
  const tunnelUrl: string | null = null;
  // Tunnel is lazy: only when LAN send fails. Still advertise null until needed.
  await upsertPeerSession({
    workspaceId: opts.workspaceId,
    profileId: opts.profileId,
    deviceId: identity.deviceId,
    lanHosts,
    lanPort: listenInfo.port,
    tunnelUrl,
    isHost: opts.isHost,
  });
  return { ...listenInfo, lanHosts, tunnelUrl };
}

export async function refreshPeers(workspaceId: string): Promise<ChatPeerEndpoint[]> {
  const sessions = await listPeerSessions(workspaceId);
  const keys = await listDeviceKeys(sessions.map((s) => s.profile_id));
  const byProfile = new Map(keys.map((k) => [k.profile_id, k.x25519_public]));
  return sessions
    .map((s) => peerSessionToEndpoint(s, byProfile.get(s.profile_id)))
    .filter((x): x is ChatPeerEndpoint => x != null);
}

export async function ensureDmRoom(opts: {
  workspaceId: string;
  myId: string;
  peerId: string;
  peerName?: string | null;
}): Promise<ChatRoom> {
  const id = dmRoomId(opts.workspaceId, opts.myId, opts.peerId);
  const existing = getLocalRoom(id);
  if (existing) {
    return existing;
  }
  const room: ChatRoom = {
    id,
    workspaceId: opts.workspaceId,
    kind: "dm",
    name: opts.peerName ?? null,
    memberIds: [opts.myId, opts.peerId].sort(),
    hostProfileId: null,
    createdAt: new Date().toISOString(),
    lastMessageAt: null,
    lastPreview: null,
    unread: 0,
  };
  upsertLocalRoom(room);
  try {
    await upsertChatRoomMeta({
      id: room.id,
      workspaceId: room.workspaceId,
      kind: "dm",
      name: room.name,
      hostProfileId: null,
      memberIds: room.memberIds,
    });
  } catch (e) {
    console.warn("chat room meta upsert failed (offline schema?):", e);
  }
  return room;
}

export async function createGroupRoom(opts: {
  workspaceId: string;
  myId: string;
  name: string;
  memberIds: string[];
}): Promise<ChatRoom> {
  const id = `grp:${opts.workspaceId}:${uuid()}`;
  const members = Array.from(new Set([opts.myId, ...opts.memberIds]));
  const roomKey = await generateGroupRoomKey();
  roomKeys.set(id, roomKey);

  const peers = await refreshPeers(opts.workspaceId);
  for (const peer of peers) {
    if (!members.includes(peer.profileId) || peer.profileId === opts.myId) {
      continue;
    }
    try {
      const wrapped = await wrapRoomKey(roomKey, peer.x25519Public);
      const frame: ChatWireFrame = {
        v: 1,
        id: uuid(),
        roomId: id,
        senderId: opts.myId,
        kind: "system",
        ciphertext: await sealChatPayload(roomKey, JSON.stringify({ type: "room_key_wrap", wrapped })),
        createdAt: new Date().toISOString(),
      };
      // Also send wrapped key in clear system channel field via ciphertext of a dedicated envelope
      await deliverToPeer(peer, {
        ...frame,
        ciphertext: wrapped,
        kind: "system",
      });
    } catch (e) {
      console.warn("wrap room key to peer failed", peer.profileId, e);
    }
  }

  const room: ChatRoom = {
    id,
    workspaceId: opts.workspaceId,
    kind: "group",
    name: opts.name,
    memberIds: members,
    hostProfileId: opts.myId,
    createdAt: new Date().toISOString(),
    lastMessageAt: null,
    lastPreview: null,
    unread: 0,
  };
  upsertLocalRoom(room);
  try {
    await upsertChatRoomMeta({
      id: room.id,
      workspaceId: room.workspaceId,
      kind: "group",
      name: room.name,
      hostProfileId: opts.myId,
      memberIds: members,
    });
  } catch (e) {
    console.warn("group meta upsert failed:", e);
  }
  return room;
}

async function getOrDeriveRoomKey(room: ChatRoom, myId: string, peers: ChatPeerEndpoint[]): Promise<string> {
  const cached = roomKeys.get(room.id);
  if (cached) {
    return cached;
  }
  if (room.kind === "dm") {
    const peerId = room.memberIds.find((id) => id !== myId);
    if (!peerId) {
      throw new Error("DM peer missing");
    }
    const peer = peers.find((p) => p.profileId === peerId);
    if (!peer) {
      throw new Error("Peer public key unavailable — peer must be online once");
    }
    const key = await deriveDmRoomKey(myId, peerId, peer.x25519Public);
    roomKeys.set(room.id, key);
    return key;
  }
  throw new Error("Group room key not yet received from host");
}

async function deliverToPeer(peer: ChatPeerEndpoint, frame: ChatWireFrame) {
  let tunnelUrl = peer.tunnelUrl;
  const result = await sendChatFrame({
    lanHosts: peer.lanHosts,
    lanPort: peer.lanPort,
    tunnelUrl,
    frameJson: JSON.stringify(frame),
  });
  if (result.via === "none") {
    const started = await tryStartTunnel();
    if (started) {
      tunnelUrl = started;
      const retry = await sendChatFrame({
        lanHosts: peer.lanHosts,
        lanPort: peer.lanPort,
        tunnelUrl,
        frameJson: JSON.stringify(frame),
      });
      if (retry.via !== "none") {
        return retry;
      }
    }
    enqueueOutbox({
      id: frame.id,
      roomId: frame.roomId,
      peerProfileId: peer.profileId,
      frameJson: JSON.stringify(frame),
      createdAt: frame.createdAt,
    });
    throw new Error(
      "Peer unreachable (LAN/tunnel). Both apps must be open on the same network, and chat signaling tables must exist.",
    );
  }
  return result;
}

function resolveDmTargets(room: ChatRoom, myId: string, peers: ChatPeerEndpoint[]): ChatPeerEndpoint[] {
  const peerId = room.memberIds.find((id) => id !== myId);
  if (!peerId) {
    throw new Error("DM peer missing");
  }
  const targets = peers.filter((p) => p.profileId === peerId);
  if (targets.length === 0) {
    throw new Error(
      "Peer is offline or has not announced presence yet. Ask them to open Horizon Gateway (main window) while signed in.",
    );
  }
  return targets;
}

export async function sendTextMessage(opts: {
  roomId: string;
  myId: string;
  workspaceId: string;
  body: string;
}): Promise<ChatMessage> {
  const room = getLocalRoom(opts.roomId);
  if (!room) {
    throw new Error("Room not found");
  }
  const peers = await refreshPeers(opts.workspaceId);
  const roomKey = await getOrDeriveRoomKey(room, opts.myId, peers);
  const createdAt = new Date().toISOString();
  const id = uuid();
  const ciphertext = await sealChatPayload(roomKey, opts.body);
  const frame: ChatWireFrame = {
    v: 1,
    id,
    roomId: opts.roomId,
    senderId: opts.myId,
    kind: "text",
    ciphertext,
    createdAt,
  };

  const local: ChatMessage = {
    id,
    roomId: opts.roomId,
    senderId: opts.myId,
    kind: "text",
    body: opts.body,
    createdAt,
    pending: true,
  };
  appendLocalMessage(local);

  if (room.kind === "dm") {
    const targets = resolveDmTargets(room, opts.myId, peers);
    for (const peer of targets) {
      await deliverToPeer(peer, frame);
    }
  } else {
    const hostId = room.hostProfileId;
    if (!hostId) {
      throw new Error("Group has no host");
    }
    if (hostId === opts.myId) {
      // Host fans out
      for (const memberId of room.memberIds) {
        if (memberId === opts.myId) {
          continue;
        }
        const peer = peers.find((p) => p.profileId === memberId);
        if (peer) {
          await deliverToPeer(peer, frame);
        }
      }
    } else {
      const host = peers.find((p) => p.profileId === hostId);
      if (!host) {
        throw new Error("Group host offline");
      }
      await deliverToPeer(host, frame);
    }
  }

  return { ...local, pending: false };
}

export async function sendAction(opts: {
  roomId: string;
  myId: string;
  workspaceId: string;
  actionKind: CommActionKind;
  /** Burst size for flies (clamped server/client side). */
  count?: number;
  /** Shown on receiver overlay. */
  senderLabel?: string;
}): Promise<void> {
  const room = getLocalRoom(opts.roomId);
  if (!room) {
    throw new Error("Room not found");
  }
  const peers = await refreshPeers(opts.workspaceId);
  const roomKey = await getOrDeriveRoomKey(room, opts.myId, peers);
  const createdAt = new Date().toISOString();
  const id = uuid();
  const ciphertext = await sealChatPayload(roomKey, opts.actionKind);
  const actionCount = opts.actionKind === "fly" ? Math.max(1, Math.min(40, Math.floor(opts.count ?? 1))) : 1;
  const senderLabel = opts.senderLabel?.trim() || undefined;
  const frame: ChatWireFrame = {
    v: 1,
    id,
    roomId: opts.roomId,
    senderId: opts.myId,
    kind: "action",
    ciphertext,
    actionKind: opts.actionKind,
    actionCount,
    senderLabel,
    createdAt,
  };
  // Actions are overlay-only on the *receiver* — do not play locally for the sender.

  const targets =
    room.kind === "dm"
      ? resolveDmTargets(room, opts.myId, peers)
      : room.hostProfileId === opts.myId
        ? peers.filter((p) => room.memberIds.includes(p.profileId) && p.profileId !== opts.myId)
        : peers.filter((p) => p.profileId === room.hostProfileId);

  if (targets.length === 0) {
    throw new Error(
      room.kind === "group"
        ? "Group host/members offline — they must have Gateway open."
        : "Peer offline — they must have Gateway open.",
    );
  }

  for (const peer of targets) {
    await deliverToPeer(peer, frame);
  }
}

export async function handleIncomingFrame(raw: string, myId: string): Promise<void> {
  let frame: ChatWireFrame;
  try {
    frame = JSON.parse(raw) as ChatWireFrame;
  } catch {
    return;
  }
  if (frame.v !== 1 || frame.senderId === myId) {
    return;
  }

  // Host fan-out: if we are host of a group and this isn't addressed only to us, rebroadcast
  const room = getLocalRoom(frame.roomId);
  if (room?.kind === "group" && room.hostProfileId === myId) {
    const peers = await refreshPeers(room.workspaceId);
    for (const memberId of room.memberIds) {
      if (memberId === myId || memberId === frame.senderId) {
        continue;
      }
      const peer = peers.find((p) => p.profileId === memberId);
      if (peer) {
        await deliverToPeer(peer, frame);
      }
    }
  }

  if (frame.kind === "system") {
    // room key wrap: ciphertext is wrapped key blob
    try {
      const { unwrapRoomKey } = await import("./crypto");
      const key = await unwrapRoomKey(frame.ciphertext);
      roomKeys.set(frame.roomId, key);
    } catch {
      /* ignore */
    }
    return;
  }

  let roomKey = roomKeys.get(frame.roomId);
  if (!roomKey && room) {
    try {
      const peers = await refreshPeers(room.workspaceId);
      roomKey = await getOrDeriveRoomKey(room, myId, peers);
    } catch {
      console.warn("Cannot decrypt chat frame — missing room key");
      return;
    }
  }
  if (!roomKey) {
    return;
  }

  let body: string;
  try {
    body = await openChatPayload(roomKey, frame.ciphertext);
  } catch {
    return;
  }

  // Actions: stacked overlay only — no chat row, unread, or OS notification.
  if (frame.kind === "action") {
    const kind = (frame.actionKind ?? body) as CommActionKind;
    const count = frame.actionCount ?? 1;
    const fromLabel = frame.senderLabel?.trim() || null;
    try {
      await playCommAction(kind, null, count, fromLabel);
    } catch (e) {
      console.warn("playCommAction failed", e);
    }
    return;
  }

  appendLocalMessage({
    id: frame.id,
    roomId: frame.roomId,
    senderId: frame.senderId,
    kind: frame.kind,
    body,
    actionKind: frame.actionKind,
    createdAt: frame.createdAt,
  });
  bumpUnread(frame.roomId, 1);

  void notifyIncomingChat({
    id: frame.id,
    roomId: frame.roomId,
    senderId: frame.senderId,
    kind: frame.kind,
    body,
    actionKind: frame.actionKind,
    createdAt: frame.createdAt,
  });

  window.dispatchEvent(new CustomEvent("hg-chat-updated", { detail: { roomId: frame.roomId } }));
}

export async function flushOutbox(workspaceId: string): Promise<void> {
  const peers = await refreshPeers(workspaceId);
  for (const item of listOutbox()) {
    const peer = item.peerProfileId ? peers.find((p) => p.profileId === item.peerProfileId) : null;
    if (!peer) {
      continue;
    }
    const result = await sendChatFrame({
      lanHosts: peer.lanHosts,
      lanPort: peer.lanPort,
      tunnelUrl: peer.tunnelUrl,
      frameJson: item.frameJson,
    });
    if (result.via !== "none") {
      removeOutbox(item.id);
    }
  }
}

export async function getPeerPresence(
  workspaceId: string,
  peerProfileId: string,
): Promise<{ online: boolean; lanHosts: string[]; lanPort: number; ageSec: number | null }> {
  const peers = await refreshPeers(workspaceId);
  const peer = peers.find((p) => p.profileId === peerProfileId);
  if (!peer) {
    return { online: false, lanHosts: [], lanPort: 0, ageSec: null };
  }
  const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(peer.updatedAt)) / 1000));
  // Presence row older than 2 minutes → treat as stale/offline for UX
  const online = ageSec < 120 && peer.lanPort > 0;
  return { online, lanHosts: peer.lanHosts, lanPort: peer.lanPort, ageSec };
}

export function loadInbox(workspaceId: string): ChatRoom[] {
  return listLocalRooms(workspaceId).sort((a, b) => {
    const at = a.lastMessageAt ?? a.createdAt;
    const bt = b.lastMessageAt ?? b.createdAt;
    return bt.localeCompare(at);
  });
}

export function loadMessages(roomId: string): ChatMessage[] {
  // Actions are overlay-only; hide any legacy action rows from older builds.
  return listLocalMessages(roomId).filter((m) => m.kind !== "action");
}

export { markRoomRead, listChatRoomMeta };
