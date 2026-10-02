import { createFileRoute } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { TeamWorkspaceShell } from "@/entities/team";
import { commands } from "@/shared/api";
import { openAvatarDressWindow } from "@/shared/lib/tauri/openChatWindow";

function menuFromOpenPath(path: string): "avatar" | null {
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  const tab = new URLSearchParams(query).get("tab");
  if (tab === "avatar" || tab === "character") {
    return "avatar";
  }
  return null;
}

export const Route = createFileRoute("/comm/")({
  component: CommPage,
});

function CommPage() {
  useEffect(() => {
    const apply = (path: string) => {
      if (menuFromOpenPath(path) === "avatar") {
        void openAvatarDressWindow();
      }
    };

    void commands.takeCompanionOpen().then((result) => {
      if (result.status === "ok" && result.data) {
        apply(result.data);
      }
    });

    const unlisten = listen<string>("companion-navigate", (event) => {
      apply(event.payload);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden bg-base-200">
      <TeamWorkspaceShell />
    </div>
  );
}
