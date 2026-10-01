export const INCOMING_MESSAGE_EVENT = "hg-chat-incoming-card";

export type IncomingMessageCard = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  /** `out` is a line this machine sent. Missing or `in` is a received line. */
  direction?: "in" | "out";
};

export function emitIncomingMessageCard(card: IncomingMessageCard): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(INCOMING_MESSAGE_EVENT, { detail: card }));
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("push_incoming_card", { card }))
    .catch((err) => console.warn("push incoming card", err));
}
