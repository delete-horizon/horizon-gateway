import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getLocalRoom } from "./localStore";
import type { ChatMessage } from "../types";

let permissionPrimed = false;

/** Ask OS notification permission once (no-op on web / denied). */
export async function ensureChatNotificationPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    permissionPrimed = granted;
    return granted;
  } catch {
    return false;
  }
}

async function isRoomWindowFocused(roomId: string): Promise<boolean> {
  try {
    const win = await WebviewWindow.getByLabel(`chat-room-${roomId}`);
    if (!win) {
      return false;
    }
    return await win.isFocused();
  } catch {
    return false;
  }
}

/** Show a system notification for an incoming text chat (not actions). */
export async function notifyIncomingChat(message: ChatMessage): Promise<void> {
  if (message.kind !== "text") {
    return;
  }
  try {
    if (await isRoomWindowFocused(message.roomId)) {
      return;
    }
    if (!permissionPrimed) {
      const ok = await ensureChatNotificationPermission();
      if (!ok) {
        return;
      }
    } else {
      const granted = await isPermissionGranted().catch(() => false);
      if (!granted) {
        return;
      }
    }

    const room = getLocalRoom(message.roomId);
    const title = room?.name?.trim() || (room?.kind === "group" ? "Group chat" : "Team chat");
    const body = message.body.slice(0, 180) || "New message";

    sendNotification({ title, body });
  } catch (e) {
    console.warn("chat notification failed", e);
  }
}
