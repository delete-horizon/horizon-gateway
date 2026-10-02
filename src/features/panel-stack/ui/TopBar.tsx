import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { useAtomValue, useSetAtom } from "jotai";
import { Bug, Gift, Lock, LogIn, Palette, Search, Server, Settings, User, Users } from "lucide-react";
import { useState } from "react";
import {
  getInitials,
  languageAtom,
  proxyRunningAtom,
  supabaseProfileAtom,
  supabaseSessionAtom,
  WindowControls,
} from "@/entities/app";
import { bugReportModalOpenAtom } from "@/features/bug-report";
import { commandPaletteOpenAtom } from "@/features/command-palette";
import { UpdateToolbarBadge, updateChangelogModalOpenAtom } from "@/features/update";
import { commands } from "@/shared/api";
import { isDevMockAuthEnabled } from "@/shared/api/devMockAuth";
import { isDevLocalPasswordAuthEnabled } from "@/shared/api/localAuth";
import { supabase } from "@/shared/api/supabase";
import { Button } from "@/shared/ui/button/Button";
import { toastError, toastInfo } from "@/shared/ui/toast";
import { en } from "../i18n/en";
import { ko } from "../i18n/ko";
import type { HubSurfaceId } from "../types";
import { ToolsMenu } from "./ToolsMenu";

const appWindow = getCurrentWindow();

interface TopBarProps {
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenTeam: () => void;
  onOpenGlobalTool: (id: HubSurfaceId) => void;
  teamOpen?: boolean;
}

export function TopBar({ onOpenProfile, onOpenSettings, onOpenTeam, onOpenGlobalTool, teamOpen = false }: TopBarProps) {
  const lang = useAtomValue(languageAtom);
  const t = lang === "ko" ? ko : en;
  const proxyRunning = useAtomValue(proxyRunningAtom);

  const session = useAtomValue(supabaseSessionAtom);
  const profile = useAtomValue(supabaseProfileAtom);
  const setPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const teamLocked = !session;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const setChangelogOpen = useSetAtom(updateChangelogModalOpenAtom);
  const setBugReportOpen = useSetAtom(bugReportModalOpenAtom);

  const handleLogin = async () => {
    if (isDevLocalPasswordAuthEnabled()) {
      toastInfo("로컬 Supabase — env 계정으로 자동 로그인됩니다.");
      return;
    }
    if (isDevMockAuthEnabled()) {
      toastInfo("VITE_DEV_MOCK_AUTH=1 — deprecated; prefer local Supabase + VITE_DEV_LOCAL_*.");
      return;
    }
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: "horizon-gateway://auth-callback",
          skipBrowserRedirect: true,
        },
      });
      if (error) {
        toastError(`Supabase OAuth Init Error: ${error.message}`);
        return;
      }
      if (data?.url) {
        await commands.openExternalUrl(data.url);
      } else {
        toastError("OAuth URL generation failed: URL was empty.");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toastError(`handleLogin Exception: ${message}`);
    }
  };

  const handleLogout = async () => {
    if (isDevLocalPasswordAuthEnabled()) {
      await supabase.auth.signOut();
      toastInfo("로컬 세션을 종료했습니다. 재시작 시 env 계정으로 다시 로그인됩니다.");
      return;
    }
    if (isDevMockAuthEnabled()) {
      toastInfo("모킹 인증은 .env에서 VITE_DEV_MOCK_AUTH를 끄고 재시작해야 해제됩니다.");
      return;
    }
    await supabase.auth.signOut();
  };

  return (
    <div className="flex items-center h-10 border-b border-base-300/50 bg-base-200 shrink-0 select-none">
      <div className="flex items-center gap-3 px-3 min-w-0 shrink-0">
        <img
          src="/logo-text.svg"
          alt="Horizon Gateway"
          className="chrome-brand-logo h-4 w-auto object-contain shrink-0 pointer-events-none"
        />
        <button
          type="button"
          data-tauri-drag-region={false}
          onClick={onOpenSettings}
          className={clsx(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors",
            proxyRunning
              ? "bg-success/10 text-success border border-success/20"
              : "bg-base-300 text-base-content/55 border border-base-300",
          )}
        >
          <Server className="w-3 h-3" />
          {proxyRunning ? t.proxyRunning : t.proxyStopped}
        </button>
      </div>

      <div
        data-tauri-drag-region
        onDoubleClick={() => appWindow.toggleMaximize()}
        className="flex-1 flex items-center justify-center h-full min-w-[48px] cursor-default px-4"
      >
        <button
          type="button"
          data-tauri-drag-region={false}
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2 px-3 py-1 rounded-lg bg-base-100/90 border border-base-300 text-base-content/55 hover:text-base-content hover:bg-base-300/80 transition-all text-xs w-full max-w-md"
        >
          <Search className="w-3.5 h-3.5 text-base-content/40 shrink-0" />
          <span className="flex-1 text-left truncate text-[11px]">
            {lang === "ko" ? "명령어 및 도메인 검색..." : "Type a command or search..."}
          </span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.2 rounded bg-base-300 text-[10px] font-mono text-base-content/55 border border-base-300">
            Ctrl+P
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-0.5 px-2 shrink-0">
        <UpdateToolbarBadge />
        <ToolsMenu onOpenTool={onOpenGlobalTool} />

        <Button
          variant="ghost"
          size="sm"
          className={clsx(
            "gap-1.5 h-8 text-xs",
            teamLocked
              ? "text-base-content/40 cursor-not-allowed opacity-60"
              : teamOpen
                ? "text-base-content bg-base-300"
                : "text-base-content/80 hover:text-base-content hover:bg-base-300",
          )}
          title={teamLocked ? t.teamLocked : t.team}
          aria-disabled={teamLocked}
          aria-pressed={teamOpen}
          onClick={() => {
            if (teamLocked) {
              toastInfo(t.teamLocked);
              return;
            }
            onOpenTeam();
          }}
        >
          {teamLocked ? <Lock className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{t.team}</span>
        </Button>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 text-xs text-base-content/80 hover:text-base-content hover:bg-base-300"
            onClick={() => setSettingsMenuOpen((v) => !v)}
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.settings}</span>
          </Button>

          {settingsMenuOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setSettingsMenuOpen(false)}
              />
              <div className="absolute right-0 top-9 w-44 bg-base-100 border border-base-300 rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  type="button"
                  onClick={() => {
                    onOpenSettings();
                    setSettingsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-bold text-base-content hover:bg-base-300 flex items-center gap-2 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5 text-primary" />
                  {t.settings}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenGlobalTool("chrome/theme");
                    setSettingsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-bold text-base-content hover:bg-base-300 flex items-center gap-2 cursor-pointer"
                >
                  <Palette className="w-3.5 h-3.5 text-accent" />
                  {lang === "ko" ? "테마 & 폰트 에디터" : "Theme & Font Editor"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChangelogOpen(true);
                    setSettingsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-bold text-base-content hover:bg-base-300 flex items-center gap-2 border-t border-base-300/40 cursor-pointer"
                >
                  <Gift className="w-3.5 h-3.5 text-primary" />
                  {lang === "ko" ? "업데이트 내역" : "Changelog"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBugReportOpen(true);
                    setSettingsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-bold text-base-content hover:bg-base-300 flex items-center gap-2 border-t border-base-300/40 cursor-pointer"
                >
                  <Bug className="w-3.5 h-3.5 text-error" />
                  {lang === "ko" ? "버그 리포트 & 피드백" : "Bug Report & Feedback"}
                </button>
              </div>
            </>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-8 text-xs text-base-content/80 hover:text-base-content hover:bg-base-300"
          onClick={() => setBugReportOpen(true)}
          title={lang === "ko" ? "버그 리포트 & 피드백 (Ctrl+Shift+B)" : "Bug Report & Feedback (Ctrl+Shift+B)"}
        >
          <Bug className="w-3.5 h-3.5 text-error" />
          <span className="hidden md:inline">{lang === "ko" ? "리포트" : "Report"}</span>
        </Button>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 text-xs text-base-content/80 hover:text-base-content hover:bg-base-300"
            onClick={() => setProfileMenuOpen((v) => !v)}
          >
            {session ? (
              <div
                className={clsx(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold bg-base-300 text-base-content overflow-hidden border border-base-300",
                  profile?.is_sponsor && "sponsor-glow",
                )}
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>{getInitials(profile?.display_name || profile?.email || "U")}</span>
                )}
              </div>
            ) : (
              <User className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{session ? profile?.display_name || t.profile : t.profile}</span>
          </Button>

          {profileMenuOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setProfileMenuOpen(false)}
              />
              <div className="absolute right-0 top-9 w-44 bg-base-100 border border-base-300 rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                {!session ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        handleLogin();
                        setProfileMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] font-bold text-base-content hover:bg-base-300 flex items-center gap-2 cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5 text-primary" />
                      {lang === "ko" ? "로그인" : "Login"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProfile();
                        setProfileMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] font-bold text-base-content/80 hover:bg-base-300 hover:text-base-content transition-colors cursor-pointer border-t border-base-300/40"
                    >
                      {lang === "ko" ? "프로필 설정" : "Profile Settings"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProfile();
                        setProfileMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] font-bold text-base-content/80 hover:bg-base-300 hover:text-base-content transition-colors cursor-pointer"
                    >
                      {lang === "ko" ? "프로필 설정" : "Profile Settings"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleLogout();
                        setProfileMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] font-semibold text-error hover:bg-base-300 transition-colors cursor-pointer border-t border-base-300/40"
                    >
                      Logout
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <WindowControls scope="main" />
    </div>
  );
}
