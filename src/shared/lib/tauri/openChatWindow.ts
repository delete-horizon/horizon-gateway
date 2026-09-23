import { emitTo } from "@tauri-apps/api/event";
import { commands, unwrap } from "@/shared/api";

const INBOX = {
  label: "chat-inbox",
  title: "Team Chat",
  url: "/chat",
  width: 360,
  height: 640,
} as const;

export const AVATAR_EDITOR_OPEN_EVENT = "avatar-editor-open";

export type AvatarEditorTarget = { slot: string; id: string; ownedId?: string };

export async function openChatInboxWindow(): Promise<void> {
  unwrap(await commands.openWindow(INBOX.label, INBOX.title, INBOX.url, INBOX.width, INBOX.height));
}

export async function openAvatarDressWindow(): Promise<void> {
  unwrap(await commands.openWindow("chat-avatar-dress", "아바타 꾸미기", "/chat/avatar", 520, 780));
}

export async function openAvatarCatalogWindow(): Promise<void> {
  unwrap(await commands.openWindow("chat-avatar-catalog", "아바타 카탈로그", "/chat/avatar-catalog", 720, 840));
}

export async function openAvatarStudioWindow(part?: AvatarEditorTarget): Promise<void> {
  const params = new URLSearchParams();
  if (part?.slot) {
    params.set("slot", part.slot);
  }
  if (part?.id) {
    params.set("id", part.id);
  }
  if (part?.ownedId) {
    params.set("owned", part.ownedId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  unwrap(await commands.openWindow("chat-avatar-studio", "아바타 제작", `/chat/avatar-studio${query}`, 920, 800));
  if (part) {
    await emitTo("chat-avatar-studio", AVATAR_EDITOR_OPEN_EVENT, part);
  }
}

export async function openOverlayPlaygroundWindow(): Promise<void> {
  unwrap(await commands.openWindow("chat-playground", "Overlay lab", "/chat/playground", 420, 720));
}

export async function openChatRoomWindow(roomId: string, title?: string): Promise<void> {
  const label = `chat-room-${roomId}`;
  const url = `/chat/${encodeURIComponent(roomId)}`;
  unwrap(await commands.openWindow(label, title ?? "Chat", url, 380, 720));
}
