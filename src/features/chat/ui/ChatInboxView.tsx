import { useAtomValue } from "jotai";
import { MessageCircle, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { languageAtom, supabaseSessionAtom } from "@/entities/app";
import {
  createGroupRoom,
  loadInbox,
  type ChatRoom,
} from "@/entities/chat";
import { openChatRoomWindow } from "@/shared/lib/tauri/openChatWindow";
import { Button } from "@/shared/ui/button/Button";
import { Input } from "@/shared/ui/input/Input";
import { ChatShell } from "./ChatShell";

interface ChatInboxViewProps {
  workspaceId: string;
  myId: string;
  memberOptions: { id: string; label: string }[];
}

export function ChatInboxView({ workspaceId, myId, memberOptions }: ChatInboxViewProps) {
  const lang = useAtomValue(languageAtom);
  const session = useAtomValue(supabaseSessionAtom);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    setRooms(loadInbox(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    const onUpd = () => refresh();
    window.addEventListener("hg-chat-updated", onUpd);
    return () => window.removeEventListener("hg-chat-updated", onUpd);
  }, [refresh]);

  if (!session) {
    return (
      <ChatShell title={lang === "ko" ? "팀 채팅" : "Team Chat"}>
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-base-content/50">
          {lang === "ko" ? "GitHub 로그인이 필요합니다." : "Sign in with GitHub required."}
        </div>
      </ChatShell>
    );
  }

  return (
    <ChatShell title={lang === "ko" ? "팀 채팅" : "Team Chat"}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-base-content/45">
            <MessageCircle className="w-8 h-8 opacity-40" />
            <p className="text-sm font-medium">
              {lang === "ko" ? "대화가 없습니다" : "No conversations yet"}
            </p>
            <p className="text-[11px]">
              {lang === "ko" ? "멤버에서 DM을 시작하거나 그룹을 만드세요." : "Start a DM from members or create a group."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-base-300">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-base-300/50 transition-colors"
                  onClick={() => void openChatRoomWindow(room.id, room.name ?? "Chat")}
                >
                  <span className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                    {room.kind === "group" ? <Users className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">
                        {room.name ?? (room.kind === "dm" ? "DM" : "Group")}
                      </span>
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

      <div className="p-3 border-t border-base-300 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-base-content/40">
          {lang === "ko" ? "그룹 만들기" : "New group"}
        </p>
        <div className="flex gap-2">
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder={lang === "ko" ? "그룹 이름" : "Group name"}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            className="gap-1 shrink-0"
            disabled={!groupName.trim() || creating}
            onClick={() => {
              void (async () => {
                setCreating(true);
                try {
                  const room = await createGroupRoom({
                    workspaceId,
                    myId,
                    name: groupName.trim(),
                    memberIds: memberOptions.map((m) => m.id).filter((id) => id !== myId),
                  });
                  setGroupName("");
                  refresh();
                  await openChatRoomWindow(room.id, room.name ?? "Group");
                } catch (e) {
                  console.error(e);
                } finally {
                  setCreating(false);
                }
              })();
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            {lang === "ko" ? "만들기" : "Create"}
          </Button>
        </div>
      </div>
    </ChatShell>
  );
}
