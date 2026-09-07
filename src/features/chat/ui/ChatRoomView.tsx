import { useAtomValue } from "jotai";
import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageAtom } from "@/entities/app";
import {
  getLocalRoom,
  loadMessages,
  markRoomRead,
  sendAction,
  sendTextMessage,
  type ChatMessage,
  type CommActionKind,
} from "@/entities/chat";
import { Button } from "@/shared/ui/button/Button";
import { Input } from "@/shared/ui/input/Input";
import { ChatShell } from "./ChatShell";

const ACTIONS: { kind: CommActionKind; label: { ko: string; en: string } }[] = [
  { kind: "poke", label: { ko: "콕", en: "Poke" } },
  { kind: "sparkle", label: { ko: "반짝", en: "Sparkle" } },
  { kind: "ping", label: { ko: "핑", en: "Ping" } },
  { kind: "float", label: { ko: "둥둥", en: "Float" } },
  { kind: "burst", label: { ko: "팡", en: "Burst" } },
  { kind: "wave", label: { ko: "흔들", en: "Wave" } },
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const room = getLocalRoom(roomId);

  const refresh = useCallback(() => {
    setMessages(loadMessages(roomId));
    markRoomRead(roomId);
  }, [roomId]);

  useEffect(() => {
    refresh();
    const onUpd = (e: Event) => {
      const detail = (e as CustomEvent<{ roomId: string }>).detail;
      if (!detail?.roomId || detail.roomId === roomId) {
        refresh();
      }
    };
    window.addEventListener("hg-chat-updated", onUpd);
    return () => window.removeEventListener("hg-chat-updated", onUpd);
  }, [refresh, roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const title = room?.name ?? (room?.kind === "group" ? "Group" : "DM");

  return (
    <ChatShell title={title}>
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

      {error && <p className="px-3 text-[11px] text-error">{error}</p>}

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
                  refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
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
          if (!body) {
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
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={lang === "ko" ? "메시지" : "Message"}
          className="h-9 text-sm"
          disabled={busy}
        />
        <Button type="submit" size="sm" className="h-9 px-3" disabled={busy || !text.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </ChatShell>
  );
}
