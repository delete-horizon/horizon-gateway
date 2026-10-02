import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseProfileAtom, supabaseSessionAtom, userProfileAtom } from "@/entities/app";
import {
  emitIncomingMessageCard,
  ensureDmRoom,
  type IncomingMessageCard,
  isLocalDummy,
  localDummies,
  playCommAction,
  readLocalWorn,
  refsToKit,
  reloadCommAvatarCatalog,
  resolveHeldAction,
  sendAction,
} from "@/entities/chat";
import { activeWorkspaceIdAtom } from "@/entities/team";
import { openChatRoomWindow } from "@/shared/lib/tauri/openChatWindow";

const MAX_CARDS = 4;
const AUTO_DISMISS_MS = 8000;
const INCOMING_CARD_EVENT = "hg-chat-incoming-card";

function subjectParticle(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) {
    return "가";
  }
  return (last - 0xac00) % 28 === 0 ? "가" : "이";
}

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
  const dbProfile = useAtomValue(supabaseProfileAtom);
  const localProfile = useAtomValue(userProfileAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const myId = session?.user?.id ?? null;
  const senderLabel =
    dbProfile?.display_name?.trim() || localProfile.name?.trim() || dbProfile?.email?.split("@")[0] || "나";
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

  const counterCard = async (card: IncomingMessageCard) => {
    if (!myId || !workspaceId || !card.senderId) {
      return;
    }
    if (card.echoFromId && isLocalDummy(card.echoFromId)) {
      try {
        const dummy = localDummies().find((item) => item.id === card.echoFromId);
        const catalog = await reloadCommAvatarCatalog().catch(() => null);
        const held = resolveHeldAction(catalog, dummy?.kit.held ?? "none");
        const label = dummy?.label || "친구";
        await playCommAction(held.overlay, null, 1, label, myId, card.echoFromId);
        await emitIncomingMessageCard({
          id: `hit-${card.echoFromId}-${Date.now()}`,
          roomId: card.roomId,
          senderId: card.echoFromId,
          senderName: label,
          body: `${label}님이 때렸습니다.`,
          createdAt: new Date().toISOString(),
          direction: "in",
          counter: true,
        });
        dropCard(card.id);
      } catch (err) {
        console.warn("counter incoming card", err);
      }
      return;
    }
    if (card.senderId === myId) {
      return;
    }
    try {
      const catalog = await reloadCommAvatarCatalog().catch(() => null);
      const held = resolveHeldAction(catalog, refsToKit(readLocalWorn()).held);
      const room = await ensureDmRoom({
        workspaceId,
        myId,
        peerId: card.senderId,
        peerName: card.senderName,
      });
      await sendAction({
        roomId: room.id,
        myId,
        workspaceId,
        actionKind: held.overlay,
        senderLabel,
      });
      dropCard(card.id);
    } catch (err) {
      console.warn("counter incoming card", err);
    }
  };

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
        {cards.map((card) => {
          const echo = card.echoFromId ? localDummies().find((item) => item.id === card.echoFromId) : undefined;
          const sentence = card.counter
            ? ko
              ? `${card.senderName}님이 때렸습니다.`
              : `${card.senderName} hit you.`
            : card.body;
          const echoNote = echo
            ? ko
              ? `${echo.label}${subjectParticle(echo.label)} 받은 알림`
              : `Notice ${echo.label} would see`
            : "";
          return (
            <motion.div
              key={card.id}
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
              onClick={() => {
                if (!card.counter) {
                  void openCard(card);
                }
              }}
              onKeyDown={(event) => {
                if (!card.counter && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  void openCard(card);
                }
              }}
              role={card.counter ? undefined : "button"}
              tabIndex={card.counter ? undefined : 0}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span
                    className={
                      card.counter
                        ? "shrink-0 text-[10px] font-semibold text-error"
                        : card.direction === "out"
                          ? "shrink-0 text-[10px] font-semibold text-primary"
                          : "shrink-0 text-[10px] font-semibold text-base-content/45"
                    }
                  >
                    {card.counter
                      ? ko
                        ? "타격"
                        : "Hit"
                      : card.direction === "out"
                        ? ko
                          ? "발신"
                          : "Sent"
                        : ko
                          ? "수신"
                          : "In"}
                  </span>
                  <span className="line-clamp-2 text-xs font-semibold text-base-content">{card.senderName}</span>
                </span>
                <span className="shrink-0 text-[10px] text-base-content/45">{formatTime(card.createdAt, ko)}</span>
              </div>
              {echoNote ? <p className="mt-0.5 text-[10px] text-base-content/45">{echoNote}</p> : null}
              <p className="mt-0.5 line-clamp-2 text-xs text-base-content/80">{sentence}</p>
              {card.counter ? (
                <button
                  type="button"
                  className="mt-2 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-content"
                  onClick={(event) => {
                    event.stopPropagation();
                    void counterCard(card);
                  }}
                >
                  {ko ? "반격하기" : "Counter"}
                </button>
              ) : null}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
