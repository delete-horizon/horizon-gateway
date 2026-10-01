import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseSessionAtom } from "@/entities/app";
import { ensureDmRoom, type IncomingMessageCard } from "@/entities/chat";
import { activeWorkspaceIdAtom } from "@/entities/team";
import { openChatRoomWindow } from "@/shared/lib/tauri/openChatWindow";

const MAX_CARDS = 4;
const AUTO_DISMISS_MS = 8000;
const INCOMING_CARD_EVENT = "hg-chat-incoming-card";

function formatTime(iso: string, ko: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(ko ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Right-edge card list. Lives in the `chat-incoming` window, above the taskbar. */
export function IncomingMessageStack({ ko = true }: { ko?: boolean }) {
  const session = useAtomValue(supabaseSessionAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const myId = session?.user?.id ?? null;
  const [cards, setCards] = useState<IncomingMessageCard[]>([]);
  const hovered = useRef<Set<string>>(new Set());
  const timers = useRef<Map<string, number>>(new Map());

  const dropCard = useCallback((id: string) => {
    setCards((prev) => prev.filter((item) => item.id !== id));
    void invoke("dismiss_incoming_card", { id }).catch(() => {});
  }, []);

  useEffect(() => {
    void invoke<IncomingMessageCard[]>("list_incoming_cards")
      .then((list) => {
        if (Array.isArray(list)) {
          setCards(list.slice(-MAX_CARDS));
        }
      })
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    void listen<IncomingMessageCard>(INCOMING_CARD_EVENT, (event) => {
      const detail = event.payload;
      if (!detail?.id || !detail.body?.trim()) {
        return;
      }
      setCards((prev) => [...prev.filter((card) => card.id !== detail.id), detail].slice(-MAX_CARDS));
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    for (const card of cards) {
      if (timers.current.has(card.id) || hovered.current.has(card.id)) {
        continue;
      }
      const handle = window.setTimeout(() => {
        timers.current.delete(card.id);
        dropCard(card.id);
      }, AUTO_DISMISS_MS);
      timers.current.set(card.id, handle);
    }
    for (const [id, handle] of timers.current) {
      if (!cards.some((card) => card.id === id)) {
        window.clearTimeout(handle);
        timers.current.delete(id);
      }
    }
  }, [cards, dropCard]);

  useEffect(() => {
    return () => {
      for (const handle of timers.current.values()) {
        window.clearTimeout(handle);
      }
      timers.current.clear();
    };
  }, []);

  const openCard = async (card: IncomingMessageCard) => {
    if (!myId || !workspaceId || !card.senderId) {
      return;
    }
    try {
      const room = await ensureDmRoom({
        workspaceId,
        myId,
        peerId: card.senderId,
        peerName: card.senderName,
      });
      await openChatRoomWindow(room.id, card.senderName);
      dropCard(card.id);
    } catch (err) {
      console.warn("open incoming card", err);
    }
  };

  return (
    <div className="flex h-full w-full flex-col justify-end gap-1 bg-transparent p-1">
      <AnimatePresence initial={false}>
        {cards.map((card) => (
          <motion.button
            key={card.id}
            type="button"
            layout
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.18 }}
            className="w-full shrink-0 rounded-lg border border-base-300 bg-base-100/95 px-3 py-2 text-left shadow-md"
            onMouseEnter={() => {
              hovered.current.add(card.id);
              const handle = timers.current.get(card.id);
              if (handle) {
                window.clearTimeout(handle);
                timers.current.delete(card.id);
              }
            }}
            onMouseLeave={() => {
              hovered.current.delete(card.id);
              if (!timers.current.has(card.id)) {
                const handle = window.setTimeout(() => {
                  timers.current.delete(card.id);
                  dropCard(card.id);
                }, AUTO_DISMISS_MS);
                timers.current.set(card.id, handle);
              }
            }}
            onClick={() => void openCard(card)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span
                  className={
                    card.direction === "out"
                      ? "shrink-0 text-[10px] font-semibold text-primary"
                      : "shrink-0 text-[10px] font-semibold text-base-content/45"
                  }
                >
                  {card.direction === "out" ? (ko ? "발신" : "Sent") : ko ? "수신" : "In"}
                </span>
                <span className="line-clamp-2 text-xs font-semibold text-base-content">{card.senderName}</span>
              </span>
              <span className="shrink-0 text-[10px] text-base-content/45">{formatTime(card.createdAt, ko)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-base-content/80">{card.body}</p>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
