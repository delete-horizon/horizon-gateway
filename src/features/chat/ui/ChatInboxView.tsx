import { useAtomValue } from "jotai";
import { MessageCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { languageAtom, supabaseSessionAtom } from "@/entities/app";
import { type ChatRoom, loadInbox, syncRemoteRooms } from "@/entities/chat";
import { openChatRoomWindow, openOverlayPlaygroundWindow } from "@/shared/lib/tauri/openChatWindow";
import { ChatShell } from "./ChatShell";
import { TeamRecipientComposer } from "./TeamRecipientComposer";

interface ChatInboxViewProps {
  workspaceId: string;
  myId: string;
  memberOptions: { id: string; label: string }[];
  embedded?: boolean;
}

export function ChatInboxView({ workspaceId, myId, memberOptions, embedded }: ChatInboxViewProps) {
  const lang = useAtomValue(languageAtom);
  const session = useAtomValue(supabaseSessionAtom);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);

  const refresh = useCallback(() => {
    setRooms(loadInbox(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    void syncRemoteRooms(workspaceId, myId).then(() => refresh());
    const onUpd = () => refresh();
    window.addEventListener("hg-chat-updated", onUpd);
    return () => window.removeEventListener("hg-chat-updated", onUpd);
  }, [refresh, workspaceId, myId]);

  const conversations = rooms.filter((room) => room.kind === "dm");

  if (!session) {
    return (
      <ChatShell embedded={embedded} title={lang === "ko" ? "팀 채팅" : "Team Chat"}>
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-base-content/50">
          {lang === "ko" ? "GitHub 로그인이 필요합니다." : "Sign in with GitHub required."}
        </div>
      </ChatShell>
    );
  }

  return (
    <ChatShell embedded={embedded} title={lang === "ko" ? "팀 채팅" : "Team Chat"}>
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => void openOverlayPlaygroundWindow()}
          className="w-full text-left text-[11px] px-2 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15"
        >
          {lang === "ko" ? "오버레이 실험실 · 나한테 말 걸어보기" : "Overlay lab · talk to yourself"}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-base-content/45">
            <MessageCircle className="w-8 h-8 opacity-40" />
            <p className="text-sm font-medium">{lang === "ko" ? "대화가 없습니다" : "No conversations yet"}</p>
            <p className="text-[11px]">
              {lang === "ko" ? "아래에서 받을 사람을 고르고 보내세요." : "Pick people below and send."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-base-300">
            {conversations.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-base-300/50 transition-colors"
                  onClick={() => void openChatRoomWindow(room.id, room.name ?? "Chat")}
                >
                  <span className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                    <MessageCircle className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{room.name ?? "DM"}</span>
                      {room.unread > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">
                          {room.unread}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-base-content/45 truncate">
                      {room.lastPreview ?? (lang === "ko" ? "메시지 없음" : "No messages")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TeamRecipientComposer workspaceId={workspaceId} myId={myId} members={memberOptions} ko={lang === "ko"} />
    </ChatShell>
  );
}
