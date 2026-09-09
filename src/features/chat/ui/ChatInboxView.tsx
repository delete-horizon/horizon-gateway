import { useAtomValue } from "jotai";
import { Check, ChevronDown, ChevronUp, MessageCircle, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { languageAtom, supabaseSessionAtom } from "@/entities/app";
import { type ChatRoom, createGroupRoom, loadInbox, syncRemoteRooms } from "@/entities/chat";
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
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const otherMembers = memberOptions.filter((m) => m.id !== myId);

  const refresh = useCallback(() => {
    setRooms(loadInbox(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    void syncRemoteRooms(workspaceId, myId).then(() => refresh());
    const onUpd = () => refresh();
    window.addEventListener("hg-chat-updated", onUpd);
    return () => window.removeEventListener("hg-chat-updated", onUpd);
  }, [refresh, workspaceId, myId]);

  const toggleSelectMember = (id: string) => {
    setSelectedMemberIds((prev) => (prev.includes(id) ? prev.filter((mId) => mId !== id) : [...prev, id]));
  };

  const selectAll = () => {
    setSelectedMemberIds(otherMembers.map((m) => m.id));
  };

  const deselectAll = () => {
    setSelectedMemberIds([]);
  };

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
            <p className="text-sm font-medium">{lang === "ko" ? "대화가 없습니다" : "No conversations yet"}</p>
            <p className="text-[11px]">
              {lang === "ko"
                ? "멤버에서 DM을 시작하거나 그룹을 만드세요."
                : "Start a DM from members or create a group."}
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
                      {room.kind === "group" && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-base-300 text-base-content/60">
                          {room.memberIds.length}명
                        </span>
                      )}
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

      <div className="p-3 border-t border-base-300 space-y-2 bg-base-100 shrink-0">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowCreateGroup((prev) => !prev)}
            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-base-content/60 hover:text-base-content transition-colors"
          >
            <span>{lang === "ko" ? "새 그룹 만들기" : "New group"}</span>
            {showCreateGroup ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          {showCreateGroup && otherMembers.length > 0 && (
            <div className="flex items-center gap-2 text-[10px]">
              <button type="button" onClick={selectAll} className="text-emerald-600 hover:underline">
                {lang === "ko" ? "전체 선택" : "All"}
              </button>
              <span className="text-base-content/30">·</span>
              <button type="button" onClick={deselectAll} className="text-base-content/50 hover:underline">
                {lang === "ko" ? "해제" : "Clear"}
              </button>
            </div>
          )}
        </div>

        {showCreateGroup && (
          <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex gap-2">
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={lang === "ko" ? "그룹 이름 입력" : "Enter group name"}
                className="h-8 text-xs flex-1"
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
                        memberIds: selectedMemberIds,
                      });
                      setGroupName("");
                      setSelectedMemberIds([]);
                      setShowCreateGroup(false);
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
                {lang === "ko" ? `만들기 (${selectedMemberIds.length}명)` : `Create (${selectedMemberIds.length})`}
              </Button>
            </div>

            {otherMembers.length > 0 ? (
              <div className="max-h-28 overflow-y-auto space-y-1 p-1 border border-base-300 rounded-md bg-base-200/50">
                <p className="text-[10px] text-base-content/40 px-1 font-medium">
                  {lang === "ko" ? "참여할 멤버 선택" : "Select members to invite"}
                </p>
                <div className="flex flex-wrap gap-1">
                  {otherMembers.map((member) => {
                    const selected = selectedMemberIds.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleSelectMember(member.id)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] transition-colors border ${
                          selected
                            ? "bg-emerald-500/15 border-emerald-500 text-emerald-600 font-medium"
                            : "bg-base-100 border-base-300 text-base-content/70 hover:bg-base-200"
                        }`}
                      >
                        <span
                          className={`w-3 h-3 rounded-full flex items-center justify-center border text-[8px] ${
                            selected
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "border-base-content/30 bg-base-100"
                          }`}
                        >
                          {selected && <Check className="w-2.5 h-2.5" />}
                        </span>
                        <span>{member.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-base-content/40 italic px-1">
                {lang === "ko" ? "워크스페이스에 다른 멤버가 없습니다." : "No other members in workspace."}
              </p>
            )}
          </div>
        )}
      </div>
    </ChatShell>
  );
}
