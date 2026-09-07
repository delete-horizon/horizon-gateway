import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { supabaseSessionAtom } from "@/entities/app";
import { listMembers } from "@/entities/team/api";
import { activeWorkspaceIdAtom } from "@/entities/team/store";
import { ChatInboxView } from "@/features/chat";

function ChatInboxPage() {
  const session = useAtomValue(supabaseSessionAtom);
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const myId = session?.user?.id ?? "";
  const [members, setMembers] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    void listMembers(workspaceId)
      .then((list) =>
        setMembers(
          list.map((m) => ({
            id: m.profile_id,
            label: m.profile?.display_name || m.profile?.email || m.profile_id,
          })),
        ),
      )
      .catch(console.error);
  }, [workspaceId]);

  const ws = workspaceId ?? "";

  const memberOptions = useMemo(() => members, [members]);

  if (!ws || !myId) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-base-content/50 p-6 text-center">
        Select a workspace and sign in to use team chat.
      </div>
    );
  }

  return <ChatInboxView workspaceId={ws} myId={myId} memberOptions={memberOptions} />;
}

export const Route = createFileRoute("/chat/")({
  component: ChatInboxPage,
});
