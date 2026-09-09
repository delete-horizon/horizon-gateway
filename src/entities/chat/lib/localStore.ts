import type { ChatMessage, ChatOutboxItem, ChatRoom } from "../types";

const ROOMS_KEY = "hg_chat_rooms_v1";
const MESSAGES_PREFIX = "hg_chat_msgs_v1:";
const OUTBOX_KEY = "hg_chat_outbox_v1";
const LAST_READ_PREFIX = "hg_chat_read_v1:";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function listLocalRooms(workspaceId: string): ChatRoom[] {
  return readJson<ChatRoom[]>(ROOMS_KEY, []).filter((r) => r.workspaceId === workspaceId);
}

export function upsertLocalRoom(room: ChatRoom): void {
  const all = readJson<ChatRoom[]>(ROOMS_KEY, []);
  const idx = all.findIndex((r) => r.id === room.id);
  if (idx >= 0) {
    all[idx] = room;
  } else {
    all.unshift(room);
  }
  writeJson(ROOMS_KEY, all);
}

export function getLocalRoom(roomId: string): ChatRoom | null {
  return readJson<ChatRoom[]>(ROOMS_KEY, []).find((r) => r.id === roomId) ?? null;
}

export function listLocalMessages(roomId: string): ChatMessage[] {
  return readJson<ChatMessage[]>(MESSAGES_PREFIX + roomId, []);
}

export function appendLocalMessage(message: ChatMessage): void {
  const list = listLocalMessages(message.roomId);
  if (list.some((m) => m.id === message.id)) {
    return;
  }
  list.push(message);
  writeJson(MESSAGES_PREFIX + message.roomId, list);

  const room = getLocalRoom(message.roomId);
  if (room) {
    upsertLocalRoom({
      ...room,
      lastMessageAt: message.createdAt,
      lastPreview: message.kind === "action" ? `[action:${message.actionKind ?? "poke"}]` : message.body,
    });
  }
}

export function updateLocalMessage(
  roomId: string,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage | null {
  const list = listLocalMessages(roomId);
  const idx = list.findIndex((m) => m.id === messageId);
  if (idx < 0) {
    return null;
  }
  const updated = updater(list[idx]);
  list[idx] = updated;
  writeJson(MESSAGES_PREFIX + roomId, list);
  return updated;
}

export function markMessageDelivered(roomId: string, messageId: string): ChatMessage | null {
  return updateLocalMessage(roomId, messageId, (msg) => ({
    ...msg,
    pending: false,
    delivered: true,
  }));
}

export function toggleReaction(roomId: string, messageId: string, emoji: string, senderId: string): ChatMessage | null {
  return updateLocalMessage(roomId, messageId, (msg) => {
    const reactions = [...(msg.reactions ?? [])];
    const existingIdx = reactions.findIndex((r) => r.emoji === emoji);
    if (existingIdx >= 0) {
      const existing = reactions[existingIdx];
      const hasSender = existing.senderIds.includes(senderId);
      const nextSenders = hasSender
        ? existing.senderIds.filter((id) => id !== senderId)
        : [...existing.senderIds, senderId];
      if (nextSenders.length === 0) {
        reactions.splice(existingIdx, 1);
      } else {
        reactions[existingIdx] = { ...existing, senderIds: nextSenders };
      }
    } else {
      reactions.push({ emoji, senderIds: [senderId] });
    }
    return { ...msg, reactions };
  });
}

export function bumpUnread(roomId: string, delta = 1): void {
  const room = getLocalRoom(roomId);
  if (!room) {
    return;
  }
  upsertLocalRoom({ ...room, unread: Math.max(0, room.unread + delta) });
}

export function markRoomRead(roomId: string): void {
  const room = getLocalRoom(roomId);
  if (room && room.unread !== 0) {
    upsertLocalRoom({ ...room, unread: 0 });
  }
  writeJson(LAST_READ_PREFIX + roomId, new Date().toISOString());
}

export function listOutbox(): ChatOutboxItem[] {
  return readJson<ChatOutboxItem[]>(OUTBOX_KEY, []);
}

export function enqueueOutbox(item: ChatOutboxItem): void {
  const list = listOutbox();
  list.push(item);
  writeJson(OUTBOX_KEY, list);
}

export function removeOutbox(id: string): void {
  writeJson(
    OUTBOX_KEY,
    listOutbox().filter((i) => i.id !== id),
  );
}

export function dmRoomId(workspaceId: string, a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `dm:${workspaceId}:${x}:${y}`;
}
