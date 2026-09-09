/** Cross-webview chat UI sync (BroadcastChannel + local CustomEvent). */

const CHANNEL_NAME = "hg-chat-ui-v1";

export const CHAT_UPDATED_EVENT = "hg-chat-updated";
export const CHAT_TYPING_EVENT = "hg-chat-typing";

type ChatUiBroadcast =
  | { type: "updated"; roomId?: string }
  | { type: "typing"; roomId: string; senderId: string; senderLabel?: string };

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) {
    return channel;
  }
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

export function emitChatUpdated(roomId?: string): void {
  const detail = { roomId };
  window.dispatchEvent(new CustomEvent(CHAT_UPDATED_EVENT, { detail }));
  getChannel()?.postMessage({ type: "updated", roomId } satisfies ChatUiBroadcast);
}

export function emitChatTyping(detail: { roomId: string; senderId: string; senderLabel?: string }): void {
  window.dispatchEvent(new CustomEvent(CHAT_TYPING_EVENT, { detail }));
  getChannel()?.postMessage({ type: "typing", ...detail } satisfies ChatUiBroadcast);
}

/**
 * Bridge BroadcastChannel + localStorage `storage` events into window CustomEvents
 * so chat popups refresh when the main window mutates chat state.
 */
export function installChatUiBridge(): () => void {
  const c = getChannel();
  const onBroadcast = (event: MessageEvent<ChatUiBroadcast>) => {
    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.type === "updated") {
      window.dispatchEvent(new CustomEvent(CHAT_UPDATED_EVENT, { detail: { roomId: data.roomId } }));
      return;
    }
    if (data.type === "typing") {
      window.dispatchEvent(
        new CustomEvent(CHAT_TYPING_EVENT, {
          detail: {
            roomId: data.roomId,
            senderId: data.senderId,
            senderLabel: data.senderLabel,
          },
        }),
      );
    }
  };
  c?.addEventListener("message", onBroadcast);

  const onStorage = (event: StorageEvent) => {
    if (!event.key) {
      return;
    }
    if (event.key === "hg_chat_rooms_v1" || event.key === "hg_chat_outbox_v1") {
      window.dispatchEvent(new CustomEvent(CHAT_UPDATED_EVENT, { detail: {} }));
      return;
    }
    const prefix = "hg_chat_msgs_v1:";
    if (event.key.startsWith(prefix)) {
      window.dispatchEvent(
        new CustomEvent(CHAT_UPDATED_EVENT, {
          detail: { roomId: event.key.slice(prefix.length) },
        }),
      );
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    c?.removeEventListener("message", onBroadcast);
    window.removeEventListener("storage", onStorage);
  };
}
