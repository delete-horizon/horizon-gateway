import { useAtomValue } from "jotai";
import { ArrowLeft, Lock, Users } from "lucide-react";
import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import { languageAtom, supabaseSessionAtom } from "@/entities/app";
import { Button } from "@/shared/ui/button/Button";
import { useTeamWorkspace } from "../model/useTeamWorkspace";
import { BillingPanel } from "./BillingPanel";
import { MembersPanel } from "./MembersPanel";
import { SyncPanel } from "./SyncPanel";
import { WorkspaceHomePanel } from "./WorkspaceHomePanel";
import { WorkspaceListPane } from "./WorkspaceListPane";
import { WorkspaceOnboardingPanel } from "./WorkspaceOnboardingPanel";

export interface TeamWorkspaceShellProps {
  onCloseToHub?: () => void;
  escapeRef?: MutableRefObject<(() => boolean) | null>;
}

export function TeamWorkspaceShell({ onCloseToHub, escapeRef }: TeamWorkspaceShellProps) {
  const session = useAtomValue(supabaseSessionAtom);
  const lang = useAtomValue(languageAtom);
  const ctrl = useTeamWorkspace();
  const handleEscapeRef = useRef(ctrl.handleEscape);
  handleEscapeRef.current = ctrl.handleEscape;

  useEffect(() => {
    if (!escapeRef) {
      return;
    }
    escapeRef.current = () => handleEscapeRef.current();
    return () => {
      escapeRef.current = null;
    };
  }, [escapeRef]);

  if (!session) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center bg-base-100 p-8">
        <div className="max-w-md text-center flex flex-col items-center gap-4">
          <div className="p-4 bg-base-200 text-base-content/50 rounded-full">
            <Lock className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-lg font-bold">
              {lang === "ko" ? "팀 기능이 잠겨 있습니다" : "Team features are locked"}
            </h2>
            <p className="text-sm text-base-content/60 mt-2 leading-relaxed">
              {lang === "ko"
                ? "팀 채팅·워크스페이스는 GitHub 로그인이 필요합니다."
                : "Team chat and workspaces need GitHub sign-in."}
            </p>
          </div>
          {onCloseToHub ? (
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={onCloseToHub}>
              <ArrowLeft className="w-3.5 h-3.5" />
              {lang === "ko" ? "도메인으로" : "Back to domains"}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!ctrl.userId) {
    return null;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-base-200">
      <div className="flex items-center gap-2 h-9 px-3 border-b border-base-300 bg-base-100 shrink-0">
        {onCloseToHub ? (
          <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={onCloseToHub}>
            <ArrowLeft className="w-3.5 h-3.5" />
            {lang === "ko" ? "도메인으로" : "Domains"}
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-bold text-base-content/70">
            <Users className="w-3.5 h-3.5 text-emerald-500" />
            {lang === "ko" ? "팀 워크스페이스" : "Team Workspaces"}
          </span>
        )}
        {ctrl.activeWorkspace && (
          <span className="text-[10px] text-base-content/40 truncate">
            / {ctrl.activeWorkspace.name}
            {ctrl.panels.includes("members") ? (lang === "ko" ? " / 멤버" : " / Members") : ""}
            {ctrl.panels.includes("sync") ? (lang === "ko" ? " / 동기화" : " / Sync") : ""}
            {ctrl.panels.includes("billing") ? (lang === "ko" ? " / 요금제" : " / Billing") : ""}
          </span>
        )}
        {ctrl.supaProfile?.email && (
          <span className="ml-auto text-[10px] text-base-content/35 truncate max-w-[200px]">
            {ctrl.supaProfile.email}
          </span>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        {ctrl.workspaces.length === 0 ? (
          <WorkspaceOnboardingPanel ctrl={ctrl} />
        ) : (
          <>
            <WorkspaceListPane ctrl={ctrl} />

            {ctrl.panels.includes("home") && <WorkspaceHomePanel ctrl={ctrl} onClose={ctrl.clearWorkspaceSelection} />}
            {ctrl.panels.includes("members") && <MembersPanel ctrl={ctrl} onClose={ctrl.closeLastPanel} />}
            {ctrl.panels.includes("sync") && <SyncPanel ctrl={ctrl} onClose={ctrl.closeLastPanel} />}
            {ctrl.panels.includes("billing") && <BillingPanel ctrl={ctrl} onClose={ctrl.closeLastPanel} />}

            {ctrl.panels.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-base-100 min-w-[240px]">
                <div className="w-14 h-14 rounded-2xl bg-base-200 flex items-center justify-center mb-3">
                  <Users className="w-7 h-7 text-base-content/20" />
                </div>
                <p className="text-sm font-bold text-base-content/50">
                  {lang === "ko" ? "워크스페이스를 선택하세요" : "Select a workspace"}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
