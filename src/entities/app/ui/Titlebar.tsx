import { useLocation, useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { AppWindow, Monitor } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { commands } from "@/shared/api";
import { openAvatarDressWindow } from "@/shared/lib/tauri/openChatWindow";
import { useIsDetached } from "@/shared/lib/tauri/useIsDetached";
import { toastError } from "@/shared/ui/toast";
import { languageAtom } from "../i18n/store";
import { openHubApp, openWorkspaceCompanion } from "../openCompanionApp";
import { WindowControls } from "./WindowControls";

const appWindow = getCurrentWindow();

type CommMenu = "lab";

function commMenuFromSearch(search: unknown): CommMenu | null {
  if (!search || typeof search !== "object" || !("menu" in search)) {
    return null;
  }
  const menu = (search as { menu?: unknown }).menu;
  if (menu === "lab" && import.meta.env.DEV) {
    return "lab";
  }
  return null;
}

function CommTitleMenus({
  menu,
  showLab,
  ko,
  onMenu,
  onOpenAvatar,
  onOpenHub,
}: {
  menu: CommMenu | null;
  showLab: boolean;
  ko: boolean;
  onMenu: (next: CommMenu | null) => void;
  onOpenAvatar: () => void;
  onOpenHub: () => void;
}) {
  return (
    <div className="flex items-center h-full mr-1">
      <TitleMenuButton active={false} onClick={onOpenAvatar}>
        {ko ? "아바타" : "Avatar"}
      </TitleMenuButton>
      {showLab ? (
        <TitleMenuButton active={menu === "lab"} onClick={() => onMenu(menu === "lab" ? null : "lab")}>
          {ko ? "실험실" : "Lab"}
        </TitleMenuButton>
      ) : null}
      <TitleMenuButton active={false} onClick={onOpenHub}>
        {ko ? "Hub 열기" : "Open Hub"}
      </TitleMenuButton>
    </div>
  );
}

function TitleMenuButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={clsx(
        "h-full px-2.5 text-xs font-semibold",
        active ? "text-slate-100 bg-slate-800" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface TitlebarProps {
  /** Extra actions rendered before window controls (e.g. update badge). */
  trailing?: ReactNode;
}

export function Titlebar({ trailing }: TitlebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isDetached = useIsDetached();
  const lang = useAtomValue(languageAtom);
  const [shellRole, setShellRole] = useState<"hub" | "workspace">("hub");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isComm = location.pathname === "/comm" || location.pathname.startsWith("/comm/");
  const commMenu = commMenuFromSearch(location.search);

  const updateState = useCallback(async () => {
    setIsFullscreen(await appWindow.isFullscreen());
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const current = await appWindow.isFullscreen();
    await appWindow.setFullscreen(!current);
    setIsFullscreen(!current);
  }, []);

  useEffect(() => {
    updateState();

    const unlistenResized = appWindow.onResized(() => updateState());

    const handleF11 = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleF11);

    return () => {
      unlistenResized.then((f) => f());
      window.removeEventListener("keydown", handleF11);
    };
  }, [updateState, toggleFullscreen]);

  useEffect(() => {
    let cancelled = false;
    void commands.appShellRole().then((result) => {
      if (cancelled || result.status === "error") {
        return;
      }
      if (result.data === "workspace" || result.data === "hub") {
        setShellRole(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isFullscreen) {
    return null;
  }

  const openOtherApp = () => {
    const open = shellRole === "workspace" ? openHubApp : openWorkspaceCompanion;
    void open().then((error) => {
      if (error) {
        toastError(error);
      }
    });
  };
  const otherAppLabel =
    shellRole === "workspace"
      ? lang === "ko"
        ? "Hub 열기"
        : "Open Hub"
      : lang === "ko"
        ? "워크스페이스 열기"
        : "Open workspace";

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => appWindow.toggleMaximize()}
      className="bg-slate-950 flex items-center justify-between select-none z-110 border-b border-slate-800/50 h-10 shrink-0 backdrop-blur-md bg-opacity-80 cursor-default"
    >
      <div className="flex items-center gap-2 px-3 pointer-events-none">
        <img src="/logo-text.svg" alt="Horizon Gateway" className="h-4 w-auto object-contain shrink-0" />
        {isDetached && (
          <span className="text-[8px] font-bold text-blue-400/80 uppercase tracking-wider ml-1">
            {location.pathname.replace(/\//g, " ").trim() || "Dashboard"}
          </span>
        )}
      </div>

      <div className="flex items-center h-full">
        {trailing ? <div className="flex items-center px-1 pointer-events-auto">{trailing}</div> : null}
        {!isDetached && !isComm && (
          <button
            type="button"
            onClick={openOtherApp}
            title={otherAppLabel}
            className="w-12 h-full flex items-center justify-center hover:bg-slate-800 text-slate-500 transition-colors"
          >
            <AppWindow className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleFullscreen()}
          title="Toggle Fullscreen (F11)"
          className="w-12 h-full flex items-center justify-center hover:bg-slate-800 text-slate-500 transition-colors"
        >
          <Monitor className={clsx("w-3.5 h-3.5", isFullscreen && "text-blue-400")} />
        </button>
        {isComm ? (
          <CommTitleMenus
            menu={commMenu}
            showLab={import.meta.env.DEV}
            ko={lang === "ko"}
            onMenu={(next) => {
              void navigate({ to: "/comm", search: next ? { menu: next } : {} });
            }}
            onOpenAvatar={() => {
              void openAvatarDressWindow().catch((error: unknown) => {
                toastError(error instanceof Error ? error.message : String(error));
              });
            }}
            onOpenHub={() => {
              void openHubApp().then((error) => {
                if (error) {
                  toastError(error);
                }
              });
            }}
          />
        ) : null}
        <WindowControls />
      </div>
    </div>
  );
}
