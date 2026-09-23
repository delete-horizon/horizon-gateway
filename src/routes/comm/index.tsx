import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { TeamWorkspaceShell } from "@/entities/team";
import { OverlayPlayground } from "@/features/chat";
import { commands } from "@/shared/api";
import { openAvatarDressWindow } from "@/shared/lib/tauri/openChatWindow";

type CommMenu = "lab";

function menuFromOpenPath(path: string): CommMenu | "avatar" | null {
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  const tab = new URLSearchParams(query).get("tab");
  if (tab === "avatar" || tab === "character") {
    return "avatar";
  }
  if (tab === "lab" && import.meta.env.DEV) {
    return "lab";
  }
  return null;
}

export const Route = createFileRoute("/comm/")({
  validateSearch: (search: Record<string, unknown>): { menu?: CommMenu } => {
    if (search.menu === "lab" && import.meta.env.DEV) {
      return { menu: "lab" };
    }
    return {};
  },
  component: CommPage,
});

function CommPage() {
  const { menu } = Route.useSearch();
  const navigate = useNavigate();
  const showLab = import.meta.env.DEV;

  useEffect(() => {
    const apply = (path: string) => {
      const next = menuFromOpenPath(path);
      if (next === "avatar") {
        void openAvatarDressWindow();
        return;
      }
      void navigate({ to: "/comm", search: next ? { menu: next } : {} });
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
  }, [navigate]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden bg-base-200">
      {menu === "lab" && showLab ? <OverlayPlayground embedded /> : null}
      {menu == null ? <TeamWorkspaceShell /> : null}
    </div>
  );
}
