import {
  listChatRoomMeta,
  listDeviceKeys,
  listPeerSessions,
  peerSessionToEndpoint,
  upsertChatRoomMeta,
  upsertDeviceKey,
  upsertPeerSession,
} from "../api/signaling";
import type { ChatMessage, ChatPeerEndpoint, ChatRoom, ChatWireFrameKind, CommActionKind } from "../types";
import {
  deriveDmRoomKey,
  ensureChatIdentity,
  generateGroupRoomKey,
  openChatPayload,
  sealChatPayload,
  wrapRoomKey,
} from "./crypto";
import { emitChatTyping, emitChatUpdated } from "./events";
import {
  appendLocalMessage,
  bumpUnread,
  dmRoomId,
  enqueueOutbox,
  getLocalRoom,
  listLocalMessages,
  listLocalRooms,
  listOutbox,
  markMessageDelivered,
  markRoomRead,
  removeOutbox,
  toggleReaction,
  updateLocalMessage,
  upsertLocalRoom,
} from "./localStore";
import { notifyIncomingChat } from "./notify";
import { getTailscaleIp, playCommAction, sendChatFrame, startChatListener, tryStartTunnel } from "./transport";

export interface ChatWireFrame {
  v: 1;
  id: string;
  roomId: string;
  senderId: string;
  kind: ChatWireFrameKind;
  ciphertext: string;
  actionKind?: CommActionKind;
  /** How many overlays to spawn (flies). Defaults to 1. */
  actionCount?: number;
  /** Display name at send time — overlay label on receiver. */
  senderLabel?: string;
  createdAt: string;
}

export interface InviteMembersResult {
  room: ChatRoom;
  /** Peers that accepted delivery immediately. */
  deliveredIds: string[];
  /** Offline / unreachable — queued in outbox for later flush. */
  pendingIds: string[];
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

async function buildGroupInviteFrame(opts: {
  room: ChatRoom;
  myId: string;
  roomKey: string;
  peerPublicKey: string;
}): Promise<ChatWireFrame> {
  const wrapped = await wrapRoomKey(opts.roomKey, opts.peerPublicKey);
  const roomCipher = await sealChatPayload(opts.roomKey, JSON.stringify(opts.room));
  return {
    v: 1,
    id: uuid(),
    roomId: opts.room.id,
    senderId: opts.myId,
    kind: "system",
    ciphertext: JSON.stringify({
      type: "group_invite",
      wrappedKey: wrapped,
      roomCipher,
    }),
    createdAt: new Date().toISOString(),
  };
}

async function deliverOrEnqueueInvite(
  peer: ChatPeerEndpoint | undefined,
  peerId: string,
  frame: ChatWireFrame,
): Promise<"delivered" | "pending"> {
  if (!peer) {
    enqueueOutbox({
      id: frame.id,
      roomId: frame.roomId,
      peerProfileId: peerId,
      frameJson: JSON.stringify(frame),
      createdAt: frame.createdAt,
    });
    return "pending";
  }
  try {
    await deliverToPeer(peer, frame);
    return "delivered";
  } catch (e) {
    console.warn("invite deliver failed; left in outbox if queued", peerId, e);
    return "pending";
  }
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

  const peers = await refreshPeers(opts.workspaceId);
  for (const memberId of members) {
    if (memberId === opts.myId) {
      continue;
    }
    const peer = peers.find((p) => p.profileId === memberId);
    if (!peer?.x25519Public) {
      console.warn("group create: peer has no device key yet; invite deferred", memberId);
      continue;
    }
    try {
      const frame = await buildGroupInviteFrame({
        room,
        myId: opts.myId,
        roomKey,
        peerPublicKey: peer.x25519Public,
      });
      await deliverOrEnqueueInvite(peer, memberId, frame);
    } catch (e) {
      console.warn("wrap room key to peer failed", memberId, e);
    }
  }

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
  emitChatUpdated(room.id);
  return room;
}

export async function inviteMembersToGroupRoom(opts: {
  roomId: string;
  workspaceId: string;
  myId: string;
  newMemberIds: string[];
}): Promise<InviteMembersResult> {
  const room = getLocalRoom(opts.roomId);
  if (!room || room.kind !== "group") {
    throw new Error("Group room not found");
  }
  if (room.hostProfileId && room.hostProfileId !== opts.myId) {
    throw new Error("Only the group host can invite members");
  }

  const uniqueNew = Array.from(new Set(opts.newMemberIds.filter((id) => id && id !== opts.myId)));
  if (uniqueNew.length === 0) {
    throw new Error("No members selected to invite");
  }

  const updatedMembers = Array.from(new Set([...room.memberIds, ...uniqueNew]));
  const peers = await refreshPeers(opts.workspaceId);
  const roomKey = await getOrDeriveRoomKey(room, opts.myId, peers);

  const updatedRoom: ChatRoom = {
    ...room,
    memberIds: updatedMembers,
  };

  const deliveredIds: string[] = [];
  const pendingIds: string[] = [];

  // 1. Deliver sealed group_invite to new members (outbox if offline)
  for (const peerId of uniqueNew) {
    const peer = peers.find((p) => p.profileId === peerId);
    if (!peer?.x25519Public) {
      pendingIds.push(peerId);
      continue;
    }
    try {
      const frame = await buildGroupInviteFrame({
        room: updatedRoom,
        myId: opts.myId,
        roomKey,
        peerPublicKey: peer.x25519Public,
      });
      const status = await deliverOrEnqueueInvite(peer, peerId, frame);
      if (status === "delivered") {
        deliveredIds.push(peerId);
      } else {
        pendingIds.push(peerId);
      }
    } catch (e) {
      console.warn("invite peer failed", peerId, e);
      pendingIds.push(peerId);
    }
  }

  if (deliveredIds.length === 0 && pendingIds.length === uniqueNew.length) {
    const withoutKeys = uniqueNew.filter((id) => !peers.find((p) => p.profileId === id)?.x25519Public);
    if (withoutKeys.length === uniqueNew.length) {
      throw new Error(
        "Invitees have no chat key yet — they must open Gateway (signed in) once before you can invite them.",
      );
    }
  }

  upsertLocalRoom(updatedRoom);

  // 2. Sealed member_joined to existing members (auth via room key + host check on receive)
  const joinedPlain = JSON.stringify({
    type: "member_joined",
    memberIds: updatedMembers,
  });
  const joinedCipher = await sealChatPayload(roomKey, joinedPlain);
  for (const memberId of room.memberIds) {
    if (memberId === opts.myId) {
      continue;
    }
    const peer = peers.find((p) => p.profileId === memberId);
    if (!peer) {
      continue;
    }
    try {
      const frame: ChatWireFrame = {
        v: 1,
        id: uuid(),
        roomId: room.id,
        senderId: opts.myId,
        kind: "system",
        ciphertext: joinedCipher,
        createdAt: new Date().toISOString(),
      };
      await deliverToPeer(peer, frame);
    } catch (e) {
      console.warn("notify joined failed", memberId, e);
    }
  }

  // 3. Update Supabase chat_rooms metadata
  try {
    await upsertChatRoomMeta({
      id: updatedRoom.id,
      workspaceId: updatedRoom.workspaceId,
      kind: "group",
      name: updatedRoom.name,
      hostProfileId: updatedRoom.hostProfileId,
      memberIds: updatedMembers,
    });
  } catch (e) {
    console.warn("update group meta failed:", e);
  }

  // 4. Append local system notice (honest about pending delivery)
  const pendingNote = pendingIds.length > 0 ? ` (오프라인 ${pendingIds.length}명은 재연결 시 자동 재시도)` : "";
  appendLocalMessage({
    id: uuid(),
    roomId: room.id,
    senderId: opts.myId,
    kind: "system",
    body: `${uniqueNew.length}명의 멤버를 초대했습니다.${pendingNote}`,
    createdAt: new Date().toISOString(),
  });

  emitChatUpdated(room.id);
  return { room: updatedRoom, deliveredIds, pendingIds };
}

export async function syncRemoteRooms(workspaceId: string, myId: string): Promise<ChatRoom[]> {
  try {
    const remoteRooms = await listChatRoomMeta(workspaceId);
    for (const r of remoteRooms) {
      if (r.member_ids.includes(myId)) {
        const local = getLocalRoom(r.id);
        if (!local) {
          const room: ChatRoom = {
            id: r.id,
            workspaceId: r.workspace_id,
            kind: r.kind,
            name: r.name,
            memberIds: r.member_ids,
            hostProfileId: r.host_profile_id,
            createdAt: r.created_at,
            lastMessageAt: null,
            lastPreview: null,
            unread: 0,
          };
          upsertLocalRoom(room);
        } else if (JSON.stringify([...local.memberIds].sort()) !== JSON.stringify([...r.member_ids].sort())) {
          upsertLocalRoom({
            ...local,
            memberIds: r.member_ids,
            name: r.name ?? local.name,
          });
        }
      }
    }
  } catch (e) {
    console.warn("syncRemoteRooms failed:", e);
  }
  return loadInbox(workspaceId);
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

  updateLocalMessage(opts.roomId, id, (m) => ({ ...m, pending: false }));
  emitChatUpdated(opts.roomId);

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
  // Receiver-only overlays — no local echo.
}

export async function sendTypingSignal(opts: {
  roomId: string;
  myId: string;
  workspaceId: string;
  senderLabel?: string;
}): Promise<void> {
  const room = getLocalRoom(opts.roomId);
  if (!room) {
    return;
  }
  try {
    const peers = await refreshPeers(opts.workspaceId);
    const roomKey = await getOrDeriveRoomKey(room, opts.myId, peers);
    const ciphertext = await sealChatPayload(roomKey, "typing");
    const frame: ChatWireFrame = {
      v: 1,
      id: uuid(),
      roomId: opts.roomId,
      senderId: opts.myId,
      kind: "typing",
      ciphertext,
      senderLabel: opts.senderLabel?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const targets =
      room.kind === "dm"
        ? resolveDmTargets(room, opts.myId, peers)
        : peers.filter((p) => room.memberIds.includes(p.profileId) && p.profileId !== opts.myId);

    for (const peer of targets) {
      void sendChatFrame({
        lanHosts: peer.lanHosts,
        lanPort: peer.lanPort,
        tunnelUrl: peer.tunnelUrl,
        frameJson: JSON.stringify(frame),
      }).catch(() => {});
    }
  } catch {
    /* typing signal is best-effort */
  }
}

export async function sendReaction(opts: {
  roomId: string;
  myId: string;
  workspaceId: string;
  targetMessageId: string;
  emoji: string;
}): Promise<void> {
  const room = getLocalRoom(opts.roomId);
  if (!room) {
    throw new Error("Room not found");
  }

  toggleReaction(opts.roomId, opts.targetMessageId, opts.emoji, opts.myId);
  emitChatUpdated(opts.roomId);

  try {
    const peers = await refreshPeers(opts.workspaceId);
    const roomKey = await getOrDeriveRoomKey(room, opts.myId, peers);
    const payload = JSON.stringify({ targetMessageId: opts.targetMessageId, emoji: opts.emoji });
    const ciphertext = await sealChatPayload(roomKey, payload);
    const frame: ChatWireFrame = {
      v: 1,
      id: uuid(),
      roomId: opts.roomId,
      senderId: opts.myId,
      kind: "reaction",
      ciphertext,
      createdAt: new Date().toISOString(),
    };

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
  } catch (e) {
    // Roll back optimistic toggle
    toggleReaction(opts.roomId, opts.targetMessageId, opts.emoji, opts.myId);
    emitChatUpdated(opts.roomId);
    throw e;
  }
}

async function sendAckToPeer(opts: {
  roomId: string;
  myId: string;
  workspaceId: string;
  targetPeerId: string;
  messageId: string;
}): Promise<void> {
  try {
    const room = getLocalRoom(opts.roomId);
    if (!room) {
      return;
    }
    const peers = await refreshPeers(opts.workspaceId);
    const peer = peers.find((p) => p.profileId === opts.targetPeerId);
    if (!peer) {
      return;
    }
    const roomKey = await getOrDeriveRoomKey(room, opts.myId, peers);
    const ciphertext = await sealChatPayload(roomKey, JSON.stringify({ messageId: opts.messageId }));
    const frame: ChatWireFrame = {
      v: 1,
      id: uuid(),
      roomId: opts.roomId,
      senderId: opts.myId,
      kind: "ack",
      ciphertext,
      createdAt: new Date().toISOString(),
    };
    void sendChatFrame({
      lanHosts: peer.lanHosts,
      lanPort: peer.lanPort,
      tunnelUrl: peer.tunnelUrl,
      frameJson: JSON.stringify(frame),
    }).catch(() => {});
  } catch (e) {
    console.warn("sendAckToPeer failed", e);
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
  if (room?.kind === "group" && room.hostProfileId === myId && frame.kind !== "system") {
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

  async function resolveRoomKey(): Promise<string | null> {
    let key = roomKeys.get(frame.roomId) ?? null;
    if (!key && room) {
      try {
        const peers = await refreshPeers(room.workspaceId);
        key = await getOrDeriveRoomKey(room, myId, peers);
      } catch {
        return null;
      }
    }
    return key;
  }

  if (frame.kind === "typing") {
    const roomKey = await resolveRoomKey();
    if (!roomKey) {
      return;
    }
    try {
      const body = await openChatPayload(roomKey, frame.ciphertext);
      if (body !== "typing") {
        return;
      }
    } catch {
      return;
    }
    emitChatTyping({
      roomId: frame.roomId,
      senderId: frame.senderId,
      senderLabel: frame.senderLabel,
    });
    return;
  }

  if (frame.kind === "system") {
    try {
      // Sealed member_joined (room-key auth) — reject plaintext member_joined.
      const roomKeyForJoined = await resolveRoomKey();
      if (roomKeyForJoined) {
        try {
          const opened = await openChatPayload(roomKeyForJoined, frame.ciphertext);
          const joined = JSON.parse(opened) as { type?: string; memberIds?: string[] };
          if (joined?.type === "member_joined" && Array.isArray(joined.memberIds)) {
            const currentRoom = getLocalRoom(frame.roomId);
            if (
              currentRoom &&
              currentRoom.hostProfileId === frame.senderId &&
              joined.memberIds.every((id) => typeof id === "string")
            ) {
              upsertLocalRoom({ ...currentRoom, memberIds: joined.memberIds });
              emitChatUpdated(frame.roomId);
            }
            return;
          }
        } catch {
          /* not a sealed member_joined — try invite envelope */
        }
      }

      let wrappedKey = frame.ciphertext;
      let invitedRoom: ChatRoom | null = null;
      let roomCipher: string | null = null;

      try {
        const parsed = JSON.parse(frame.ciphertext) as {
          type?: string;
          wrappedKey?: string;
          room?: ChatRoom;
          roomCipher?: string;
        };
        if (parsed?.type === "member_joined") {
          // Plaintext member_joined from older clients — ignore (unauthenticated).
          return;
        }
        if (parsed?.type === "group_invite" && parsed.wrappedKey) {
          wrappedKey = parsed.wrappedKey;
          roomCipher = typeof parsed.roomCipher === "string" ? parsed.roomCipher : null;
          // Legacy plaintext room (older hosts) — still validate host/id below.
          if (!roomCipher && parsed.room) {
            invitedRoom = parsed.room;
          }
        }
      } catch {
        // legacy raw base64 wrapped key string
      }

      const { unwrapRoomKey } = await import("./crypto");
      const key = await unwrapRoomKey(wrappedKey);
      roomKeys.set(frame.roomId, key);

      if (roomCipher) {
        try {
          invitedRoom = JSON.parse(await openChatPayload(key, roomCipher)) as ChatRoom;
        } catch {
          console.warn("group_invite roomCipher open failed");
          return;
        }
      }

      if (invitedRoom) {
        if (
          invitedRoom.id !== frame.roomId ||
          invitedRoom.kind !== "group" ||
          invitedRoom.hostProfileId !== frame.senderId ||
          !Array.isArray(invitedRoom.memberIds) ||
          !invitedRoom.memberIds.includes(myId)
        ) {
          console.warn("group_invite rejected: invalid room metadata or sender");
          return;
        }
        upsertLocalRoom(invitedRoom);
        appendLocalMessage({
          id: uuid(),
          roomId: frame.roomId,
          senderId: frame.senderId,
          kind: "system",
          body: `${frame.senderLabel || "호스트"}님이 회원님을 그룹에 초대했습니다.`,
          createdAt: new Date().toISOString(),
        });
        emitChatUpdated(frame.roomId);
      }
    } catch (e) {
      console.warn("handle system frame failed", e);
    }
    return;
  }

  const roomKey = await resolveRoomKey();
  if (!roomKey) {
    console.warn("Cannot decrypt chat frame — missing room key");
    return;
  }

  let body: string;
  try {
    body = await openChatPayload(roomKey, frame.ciphertext);
  } catch {
    return;
  }

  if (frame.kind === "ack") {
    try {
      const parsed = JSON.parse(body) as { messageId: string };
      if (parsed?.messageId) {
        markMessageDelivered(frame.roomId, parsed.messageId);
        emitChatUpdated(frame.roomId);
      }
    } catch (e) {
      console.warn("Failed to parse ack payload", e);
    }
    return;
  }

  if (frame.kind === "reaction") {
    try {
      const parsed = JSON.parse(body) as { targetMessageId: string; emoji: string };
      if (parsed?.targetMessageId && parsed?.emoji) {
        toggleReaction(frame.roomId, parsed.targetMessageId, parsed.emoji, frame.senderId);
        emitChatUpdated(frame.roomId);
      }
    } catch (e) {
      console.warn("Failed to parse reaction payload", e);
    }
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

  // Drop unknown wire kinds so older/newer clients never store them as chat rows.
  if (frame.kind !== "text") {
    console.warn("Ignoring unknown chat frame kind", frame.kind);
    return;
  }

  appendLocalMessage({
    id: frame.id,
    roomId: frame.roomId,
    senderId: frame.senderId,
    kind: "text",
    body,
    actionKind: frame.actionKind,
    createdAt: frame.createdAt,
    delivered: true,
  });
  bumpUnread(frame.roomId, 1);

  void notifyIncomingChat({
    id: frame.id,
    roomId: frame.roomId,
    senderId: frame.senderId,
    kind: "text",
    body,
    actionKind: frame.actionKind,
    createdAt: frame.createdAt,
  });

  if (room?.workspaceId) {
    void sendAckToPeer({
      roomId: frame.roomId,
      myId,
      workspaceId: room.workspaceId,
      targetPeerId: frame.senderId,
      messageId: frame.id,
    });
  }

  emitChatUpdated(frame.roomId);
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
