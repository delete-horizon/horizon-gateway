import { useAtomValue } from "jotai";
import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageAtom } from "@/entities/app";
import {
  type ChatMessage,
  type CommActionKind,
  getLocalRoom,
  getPeerPresence,
  loadMessages,
  markRoomRead,
  sendAction,
  sendTextMessage,
} from "@/entities/chat";
import { Button } from "@/shared/ui/button/Button";
import { Input } from "@/shared/ui/input/Input";
import { ChatShell } from "./ChatShell";

const ACTIONS: { kind: CommActionKind; label: { ko: string; en: string } }[] = [
  { kind: "poke", label: { ko: "냥", en: "Cat" } },
  { kind: "sparkle", label: { ko: "반짝", en: "Sparkle" } },
  { kind: "ping", label: { ko: "오로라", en: "Aurora" } },
  { kind: "float", label: { ko: "둥둥", en: "Float" } },
  { kind: "burst", label: { ko: "팡", en: "Burst" } },
  { kind: "wave", label: { ko: "흔들", en: "Wave" } },
  { kind: "coffee_ask", label: { ko: "커피 사주세요", en: "Buy me coffee" } },
  { kind: "coffee_give", label: { ko: "커피 사줄게요", en: "Coffee on me" } },
  { kind: "fly", label: { ko: "날파리", en: "Fly" } },
];

interface ChatRoomViewProps {
  roomId: string;
  myId: string;
  workspaceId: string;
}

export function ChatRoomView({ roomId, myId, workspaceId }: ChatRoomViewProps) {
  const lang = useAtomValue(languageAtom);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peerStatus, setPeerStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const room = getLocalRoom(roomId);

  const refresh = useCallback(() => {
    setMessages(loadMessages(roomId));
    markRoomRead(roomId);
  }, [roomId]);

  const focusInput = useCallback(() => {
    // disabled={busy} would steal focus on Enter — keep enabled and re-focus after send.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    refresh();
    focusInput();
    const onUpd = (e: Event) => {
      const detail = (e as CustomEvent<{ roomId: string }>).detail;
      if (!detail?.roomId || detail.roomId === roomId) {
        refresh();
      }
    };
    window.addEventListener("hg-chat-updated", onUpd);
    return () => window.removeEventListener("hg-chat-updated", onUpd);
  }, [refresh, roomId, focusInput]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const peerId = room?.memberIds.find((memberId) => memberId !== myId);
    if (!peerId || room?.kind !== "dm") {
      setPeerStatus(null);
      return;
    }
    let cancelled = false;
    const tick = () => {
      void getPeerPresence(workspaceId, peerId)
        .then((p) => {
          if (cancelled) {
            return;
          }
          if (!p.online) {
            setPeerStatus(
              lang === "ko"
                ? "상대 오프라인 · Gateway 메인 창이 켜져 있어야 하고, 시그널링 테이블(마이그레이션)이 적용돼 있어야 합니다."
                : "Peer offline · They need Gateway main window open, and chat signaling migration applied.",
            );
          } else {
            setPeerStatus(
              lang === "ko"
                ? `상대 온라인 신호 · ${p.lanHosts[0] ?? "?"}:${p.lanPort}`
                : `Peer presence · ${p.lanHosts[0] ?? "?"}:${p.lanPort}`,
            );
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPeerStatus(
              lang === "ko"
                ? "시그널링 조회 실패 · Supabase chat 마이그레이션을 확인하세요."
                : "Signaling lookup failed · Check Supabase chat migration.",
            );
          }
        });
    };
    tick();
    const intervalId = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [workspaceId, myId, room?.kind, room?.memberIds, lang]);

  const title = room?.name ?? (room?.kind === "group" ? "Group" : "DM");

  return (
    <ChatShell title={title}>
      {peerStatus && (
        <div className="px-3 py-1.5 text-[10px] border-b border-base-300 bg-base-100 text-base-content/60 shrink-0">
          {peerStatus}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((m) => {
          const mine = m.senderId === myId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                  mine ? "bg-emerald-600 text-white rounded-br-md" : "bg-base-100 border border-base-300 rounded-bl-md"
                }`}
              >
                {m.kind === "action" ? (
                  <span className="opacity-90 text-xs font-medium">✨ {m.actionKind ?? m.body}</span>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{m.body}</span>
                )}
                <div className={`text-[9px] mt-0.5 ${mine ? "text-white/60" : "text-base-content/35"}`}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {m.pending ? " · …" : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-3 text-[11px] text-error whitespace-pre-wrap">{error}</p>}

      <p className="px-3 text-[10px] text-base-content/45">
        {lang === "ko"
          ? "날파리는 화면 위를 날아다니며 클릭으로 잡을 수 있어요 (최대 100)."
          : "Flies buzz on-screen — click to catch (max 100)."}
      </p>

      <div className="px-2 pt-1 flex flex-wrap gap-1">
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            type="button"
            disabled={busy}
            className="text-[10px] px-2 py-1 rounded-full border border-base-300 bg-base-100 hover:bg-base-300/40 disabled:opacity-40"
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await sendAction({ roomId, myId, workspaceId, actionKind: a.kind });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                  focusInput();
                }
              })();
            }}
          >
            {lang === "ko" ? a.label.ko : a.label.en}
          </button>
        ))}
      </div>

      <form
        className="p-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body || busy) {
            return;
          }
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await sendTextMessage({ roomId, myId, workspaceId, body });
              setText("");
              refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
              refresh();
            } finally {
              setBusy(false);
              focusInput();
            }
          })();
        }}
      >
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={lang === "ko" ? "메시지" : "Message"}
          className="h-9 text-sm"
          autoFocus
        />
        <Button type="submit" size="sm" className="h-9 px-3" disabled={busy || !text.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </ChatShell>
  );
}
