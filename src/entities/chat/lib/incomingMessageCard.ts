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
  /** Body-hit notice. The button strikes `senderId` back. */
  counter?: boolean;
  /**
   * Local dummy whose inbox this card mirrors.
   * The button plays that resident's counter on this machine.
   */
  echoFromId?: string;
};

/** Pushes the card before resolving, so a closing window cannot drop it. */
export function emitIncomingMessageCard(card: IncomingMessageCard): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  window.dispatchEvent(new CustomEvent(INCOMING_MESSAGE_EVENT, { detail: card }));
  return import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("push_incoming_card", { card }))
    .then(() => undefined)
    .catch((err) => {
      console.warn("push incoming card", err);
    });
}
