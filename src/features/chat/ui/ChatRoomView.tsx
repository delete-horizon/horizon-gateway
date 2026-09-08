import { useAtomValue } from "jotai";
import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageAtom, supabaseProfileAtom, userProfileAtom } from "@/entities/app";
import {
  type ChatMessage,
  type CommActionKind,
  getLocalRoom,
  getPeerPresence,
  loadMessages,
  markRoomRead,
  sendAction,
  sendTextMessage,
  setCommOverlayTool,
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
];

const FLY_COUNTS = [1, 5, 10, 20] as const;

interface ChatRoomViewProps {
  roomId: string;
  myId: string;
  workspaceId: string;
}

export function ChatRoomView({ roomId, myId, workspaceId }: ChatRoomViewProps) {
  const lang = useAtomValue(languageAtom);
  const dbProfile = useAtomValue(supabaseProfileAtom);
  const localProfile = useAtomValue(userProfileAtom);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peerStatus, setPeerStatus] = useState<string | null>(null);
  const [sprayOn, setSprayOn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const room = getLocalRoom(roomId);

  const senderLabel =
    dbProfile?.display_name?.trim() || localProfile.name?.trim() || dbProfile?.email?.split("@")[0] || "나";

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

  const runAction = useCallback(
    async (kind: CommActionKind, count = 1) => {
      setBusy(true);
      setError(null);
      try {
        await sendAction({
          roomId,
          myId,
          workspaceId,
          actionKind: kind,
          count,
          senderLabel,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        focusInput();
      }
    },
    [roomId, myId, workspaceId, senderLabel, focusInput],
  );

  const toggleSpray = useCallback(async () => {
    const next = !sprayOn;
    setSprayOn(next);
    try {
      await setCommOverlayTool(next ? "spray" : "none");
    } catch (e) {
      setSprayOn(!next);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sprayOn]);

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
          ? "임티는 상대 화면에만 보입니다. 똥파리는 기본 클릭 통과 · 우하단 스프레이(또는 아래 토글)로만 잡아요."
          : "Actions show on the peer only. Flies stay click-through — arm spray (corner chip or toggle) to catch."}
      </p>

      <div className="px-2 pt-1 flex flex-wrap gap-1 items-center">
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleSpray()}
          className={`text-[10px] px-2 py-1 rounded-full border disabled:opacity-40 ${
            sprayOn
              ? "border-emerald-500 bg-emerald-600 text-white"
              : "border-base-300 bg-base-100 hover:bg-base-300/40"
          }`}
        >
          {lang === "ko" ? (sprayOn ? "스프레이 ON" : "스프레이") : sprayOn ? "Spray ON" : "Spray"}
        </button>
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            type="button"
            disabled={busy}
            className="text-[10px] px-2 py-1 rounded-full border border-base-300 bg-base-100 hover:bg-base-300/40 disabled:opacity-40"
            onClick={() => void runAction(a.kind)}
          >
            {lang === "ko" ? a.label.ko : a.label.en}
          </button>
        ))}
      </div>

      <div className="px-2 pb-1 flex flex-wrap gap-1 items-center">
        <span className="text-[10px] text-base-content/50 mr-1">{lang === "ko" ? "똥파리" : "Flies"}</span>
        {FLY_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            className="text-[10px] px-2 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40"
            onClick={() => void runAction("fly", n)}
          >
            ×{n}
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
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={busy || !text.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </ChatShell>
  );
}
