import { CloudUpload, CreditCard, Globe, MessageCircle, Pencil, Trash2, Users } from "lucide-react";
import { useState } from "react";
import type { TeamWorkspaceController } from "../model/useTeamWorkspace";
import { openChatInboxWindow } from "@/shared/lib/tauri/openChatWindow";
import { TeamPanelFrame } from "./TeamPanelFrame";
import { WorkspaceSettingsModal, type WorkspaceSettingsModalMode } from "./WorkspaceSettingsModal";

interface WorkspaceHomePanelProps {
  ctrl: TeamWorkspaceController;
  onClose: () => void;
}

export function WorkspaceHomePanel({ ctrl, onClose }: WorkspaceHomePanelProps) {
  const {
    lang,
    activeWorkspace,
    guard,
    unlimited,
    activeIsPro,
    isWorkspaceOwner,
    openPanel,
    openSync,
    openBilling,
    syncing,
    paidCheckoutEnabled,
  } = ctrl;
  const [settingsModal, setSettingsModal] = useState<WorkspaceSettingsModalMode | null>(null);

  if (!activeWorkspace) {
    return null;
  }

  return (
    <>
      <TeamPanelFrame
        title={activeWorkspace.name}
        subtitle={
          lang === "ko"
            ? `${activeWorkspace.plan.toUpperCase()} · ${guard.memberCount}/${unlimited ? "∞" : guard.seatLimit}명`
            : `${activeWorkspace.plan.toUpperCase()} · ${guard.memberCount}/${unlimited ? "∞" : guard.seatLimit} seats`
        }
        icon={<Globe className="w-3.5 h-3.5" />}
        onClose={onClose}
        widthClassName="w-[360px] min-w-[320px] max-w-[400px]"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-base-content/55 leading-relaxed flex-1">
              {lang === "ko"
                ? "멤버를 초대하고, 도메인·그룹·mock 설정을 동기화하세요."
                : "Invite members and sync domains/groups/mocks."}
            </p>
            {isWorkspaceOwner && (
              <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
                <button
                  type="button"
                  onClick={() => setSettingsModal("edit")}
                  className="p-1.5 rounded-md text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors"
                  title={lang === "ko" ? "수정" : "Edit"}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsModal("delete")}
                  className="p-1.5 rounded-md text-base-content/40 hover:text-error hover:bg-error/10 transition-colors"
                  title={lang === "ko" ? "삭제" : "Delete"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void openChatInboxWindow()}
            className="flex items-center gap-3 p-3 rounded-xl border border-base-200 bg-base-200/30 hover:bg-base-200/60 text-left transition-colors"
          >
            <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <MessageCircle className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{lang === "ko" ? "팀 채팅" : "Team chat"}</p>
              <p className="text-[10px] text-base-content/45">
                {lang === "ko" ? "DM · 그룹 · 의사소통 액션 (P2P)" : "DM · groups · comm actions (P2P)"}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => openPanel("members")}
            className="flex items-center gap-3 p-3 rounded-xl border border-base-200 bg-base-200/30 hover:bg-base-200/60 text-left transition-colors"
          >
            <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Users className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{lang === "ko" ? "멤버 & 초대" : "Members & invites"}</p>
              <p className="text-[10px] text-base-content/45">
                {lang === "ko"
                  ? `이메일·공유 토큰 · ${guard.memberCount}명`
                  : `Email & shareable tokens · ${guard.memberCount}`}
              </p>
            </div>
          </button>

          <button
            type="button"
            disabled={syncing !== null || guard.isLocked}
            onClick={openSync}
            className="flex items-center gap-3 p-3 rounded-xl border border-base-200 bg-base-200/30 hover:bg-base-200/60 text-left transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            <span className="p-2 rounded-lg bg-sky-500/10 text-sky-500">
              <CloudUpload className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{lang === "ko" ? "설정 동기화" : "Settings sync"}</p>
              <p className="text-[10px] text-base-content/45">
                {lang === "ko"
                  ? "카테고리별로 로컬 ↔ 서버 비교 후 Push/Pull"
                  : "Compare local ↔ server by category, then Push/Pull"}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={openBilling}
            className="flex items-center gap-3 p-3 rounded-xl border border-base-200 bg-base-200/30 hover:bg-base-200/60 text-left transition-colors"
          >
            <span className="p-2 rounded-lg bg-primary/10 text-primary">
              <CreditCard className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{lang === "ko" ? "요금제" : "Plan"}</p>
              <p className="text-[10px] text-base-content/45">
                {activeIsPro
                  ? lang === "ko"
                    ? "Team Pro / Unlimited 이용 중"
                    : "Team Pro / Unlimited active"
                  : paidCheckoutEnabled
                    ? lang === "ko"
                      ? "이 워크스페이스를 Team Pro로 업그레이드"
                      : "Upgrade this workspace to Team Pro"
                    : lang === "ko"
                      ? `Free · 좌석 ${guard.memberCount}/${guard.seatLimit}`
                      : `Free · ${guard.memberCount}/${guard.seatLimit} seats`}
              </p>
            </div>
          </button>
        </div>
      </TeamPanelFrame>

      <WorkspaceSettingsModal ctrl={ctrl} mode={settingsModal} onClose={() => setSettingsModal(null)} />
    </>
  );
}
