import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { supabaseSessionAtom } from "@/entities/app";
import { getLocalRoom } from "@/entities/chat";
import { activeWorkspaceIdAtom } from "@/entities/team/store";
import { ChatRoomView } from "@/features/chat";

function ChatRoomPage() {
  const { roomId } = Route.useParams();
  const session = useAtomValue(supabaseSessionAtom);
  const workspaceIdAtom = useAtomValue(activeWorkspaceIdAtom);
  const room = getLocalRoom(roomId);
  const myId = session?.user?.id ?? "";
  const workspaceId = room?.workspaceId ?? workspaceIdAtom ?? "";

  if (!myId || !workspaceId) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-base-content/50 p-6 text-center">
        Sign in required.
      </div>
    );
  }

  return <ChatRoomView roomId={roomId} myId={myId} workspaceId={workspaceId} />;
}

export const Route = createFileRoute("/chat/$roomId")({
  component: ChatRoomPage,
});
