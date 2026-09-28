import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { languageAtom, supabaseSessionAtom } from "@/entities/app";
import { ensureDmRoom, sendTextMessage, showCommBubble } from "@/entities/chat";
import { activeWorkspaceIdAtom } from "@/entities/team";
import { openChatRoomWindow } from "@/shared/lib/tauri/openChatWindow";

export const RESIDENT_COMPOSER_EVENT = "resident-composer-target";

type ResidentTarget = { profileId: string; name: string };

export function ResidentComposer({ initial }: { initial: ResidentTarget }) {
  const lang = useAtomValue(languageAtom);
  const ko = lang === "ko";
  const session = useAtomValue(supabaseSessionAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const myId = session?.user?.id ?? null;
  const [target, setTarget] = useState(initial);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTarget(initial);
  }, [initial]);

  useEffect(() => {
    inputRef.current?.focus();
    let unlisten: (() => void) | undefined;
    void listen<{ profileId: string; label: string }>(RESIDENT_COMPOSER_EVENT, (event) => {
      setTarget({ profileId: event.payload.profileId, name: event.payload.label });
      setDraft("");
      setStatus(null);
      inputRef.current?.focus();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const mine = Boolean(myId && target.profileId === myId);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) {
      return;
    }
    if (!myId) {
      setStatus(ko ? "로그인이 필요합니다." : "Sign in first.");
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      if (mine) {
        await showCommBubble(myId, body);
      } else {
        if (!workspaceId) {
          setStatus(ko ? "워크스페이스를 선택한 뒤 보낼 수 있습니다." : "Select a workspace first.");
          return;
        }
        const room = await ensureDmRoom({
          workspaceId,
          myId,
          peerId: target.profileId,
          peerName: target.name,
        });
        try {
          await sendTextMessage({ roomId: room.id, myId, workspaceId, body });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setStatus(
            message.toLowerCase().includes("offline")
              ? ko
                ? "상대가 꺼져 있어 이 대화에만 남겼습니다."
                : "They're offline, so this stayed in the thread on this device."
              : message,
          );
        }
        await showCommBubble(target.profileId, body);
      }
      setDraft("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const openHistory = async () => {
    if (!myId || !workspaceId || mine) {
      return;
    }
    try {
      const room = await ensureDmRoom({
        workspaceId,
        myId,
        peerId: target.profileId,
        peerName: target.name,
      });
      await openChatRoomWindow(room.id, target.name);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const pixelButton =
    "shrink-0 self-stretch border-l-2 border-[#1b1424] bg-[#f3ecdf] px-2 font-mono text-[12px] leading-none text-[#1b1424] disabled:opacity-40";

  return (
    <form
      title={status ?? target.name}
      className="fixed inset-0 box-border flex items-stretch border-2 border-[#f3ecdf] bg-[#1b1424] font-mono text-[12px] leading-none text-[#f3ecdf]"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <input
        ref={inputRef}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[12px] text-[#f3ecdf] outline-none placeholder:text-[#f3ecdf]/50"
        value={draft}
        placeholder={status ?? target.name}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className={pixelButton} disabled={sending || draft.trim().length === 0}>
        {ko ? "전송" : "Send"}
      </button>
      {mine ? null : (
        <button type="button" className={pixelButton} onClick={() => void openHistory()}>
          {ko ? "기록" : "Log"}
        </button>
      )}
      <button type="button" className={`${pixelButton} px-2.5`} onClick={() => void getCurrentWindow().close()}>
        ×
      </button>
    </form>
  );
}
