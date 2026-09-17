import { commands, unwrap } from "@/shared/api";

const INBOX = {
  label: "chat-inbox",
  title: "Team Chat",
  url: "/chat",
  width: 360,
  height: 640,
} as const;

export async function openChatInboxWindow(): Promise<void> {
  unwrap(await commands.openWindow(INBOX.label, INBOX.title, INBOX.url, INBOX.width, INBOX.height));
}

export async function openAvatarStudioWindow(): Promise<void> {
  unwrap(await commands.openWindow("chat-avatar-studio", "Avatar studio", "/chat/avatar-studio", 920, 800));
}

export async function openOverlayPlaygroundWindow(): Promise<void> {
  unwrap(await commands.openWindow("chat-playground", "Overlay lab", "/chat/playground", 420, 720));
}

export async function openChatRoomWindow(roomId: string, title?: string): Promise<void> {
  const label = `chat-room-${roomId}`;
  const url = `/chat/${encodeURIComponent(roomId)}`;
  unwrap(await commands.openWindow(label, title ?? "Chat", url, 380, 720));
}
