import { emitTo } from "@tauri-apps/api/event";
import { commands, unwrap } from "@/shared/api";
import { readAppLang } from "@/shared/lib/i18n/app-lang";

function windowTitle(ko: string, en: string): string {
  return readAppLang() === "ko" ? ko : en;
}

const INBOX = {
  label: "chat-inbox",
  title: "Team chat",
  url: "/chat",
  width: 360,
  height: 640,
} as const;

export const AVATAR_EDITOR_OPEN_EVENT = "avatar-editor-open";

export type AvatarEditorTarget = { slot: string; id: string; ownedId?: string };

export async function openChatInboxWindow(): Promise<void> {
  unwrap(
    await commands.openWindow(INBOX.label, windowTitle("팀 채팅", INBOX.title), INBOX.url, INBOX.width, INBOX.height),
  );
}

export async function openAvatarDressWindow(): Promise<void> {
  unwrap(
    await commands.openWindow(
      "chat-avatar-dress",
      windowTitle("아바타 꾸미기", "Dress avatar"),
      "/chat/avatar",
      520,
      780,
    ),
  );
}

export async function openAvatarCatalogWindow(): Promise<void> {
  unwrap(
    await commands.openWindow(
      "chat-avatar-catalog",
      windowTitle("아바타 카탈로그", "Avatar catalog"),
      "/chat/avatar-catalog",
      720,
      840,
    ),
  );
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
  unwrap(
    await commands.openWindow(
      "chat-avatar-studio",
      windowTitle("아바타 제작", "Avatar studio"),
      `/chat/avatar-studio${query}`,
      920,
      800,
    ),
  );
  if (part) {
    await emitTo("chat-avatar-studio", AVATAR_EDITOR_OPEN_EVENT, part);
  }
}

export async function openChatRoomWindow(roomId: string, title?: string): Promise<void> {
  const label = `chat-room-${roomId}`;
  const url = `/chat/${encodeURIComponent(roomId)}`;
  unwrap(await commands.openWindow(label, title ?? windowTitle("채팅", "Chat"), url, 380, 720));
}
