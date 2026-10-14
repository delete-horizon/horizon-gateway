import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { languageAtom, supabaseProfileAtom, supabaseSessionAtom } from "@/entities/app";
import { commands } from "@/shared/api";
import { isLocalSupabaseUrl } from "@/shared/api/localAuth";
import { supabase } from "@/shared/api/supabase";
import { toastError, toastInfo, toastSuccess } from "@/shared/ui/toast";
import {
  acceptInvite,
  createShareableInvite,
  createWorkspace,
  declineInvite,
  deleteWorkspace,
  inviteMember,
  listInvites,
  listMembers,
  listMyPendingInvites,
  listWorkspaces,
  type MyPendingInvite,
  removeMember,
  revokeInvite,
  setMemberRole,
  transferWorkspaceOwnership,
  updateWorkspace,
} from "../api";
import { hasProAccess, isUnlimitedTeam } from "../lib/entitlement";
import { fetchHostedCheckoutUrl, isPaidCheckoutEnabled, localDevCheckoutUrl } from "../lib/paidCheckout";
import { activeWorkspaceIdAtom } from "../store";
import { pullWorkspaceSync, pushWorkspaceSync, type WorkspaceSyncOptions } from "../sync";
import type { Workspace, WorkspaceInvite, WorkspaceMember } from "../types";
import { useWorkspaceGuard } from "./useWorkspaceGuard";
// useWorkspaceGuard lives alongside this hook

export const LEMON_CHECKOUT_URL =
  (import.meta.env.VITE_LEMON_SQUEEZY_CHECKOUT_URL as string | undefined) ||
  "https://horizon-gateway.lemonsqueezy.com/checkout/buy/7efd50de-94aa-480d-9e41-956234a36f54";

export type TeamPanelId = "home" | "members" | "sync" | "billing";

export function useTeamWorkspace() {
  const lang = useAtomValue(languageAtom);
  const session = useAtomValue(supabaseSessionAtom);
  const supaProfile = useAtomValue(supabaseProfileAtom);
  const userId = session?.user?.id ?? null;

  const [activeWorkspaceId, setActiveWorkspaceId] = useAtom(activeWorkspaceIdAtom);
  const [panels, setPanels] = useState<TeamPanelId[]>([]);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [myInvites, setMyInvites] = useState<MyPendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [syncing, setSyncing] = useState<"push" | "pull" | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [processingInviteId, setProcessingInviteId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [renamingWorkspace, setRenamingWorkspace] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [transferringOwnership, setTransferringOwnership] = useState(false);
  const [updatingMemberRoleId, setUpdatingMemberRoleId] = useState<string | null>(null);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const isWorkspaceOwner = Boolean(activeWorkspace && userId && activeWorkspace.owner_id === userId);
  const currentMembership = members.find((m) => m.profile_id === userId);
  const isWorkspaceAdmin = Boolean(
    isWorkspaceOwner || currentMembership?.role === "admin" || currentMembership?.role === "owner",
  );
  const guard = useWorkspaceGuard(activeWorkspace, members, supaProfile, { canManageTeam: isWorkspaceAdmin });

  const ownedWorkspaces = workspaces.filter((w) => w.owner_id === userId);
  const unlimited = isUnlimitedTeam(supaProfile);
  const isProOwner =
    unlimited || hasProAccess(supaProfile) || ownedWorkspaces.some((w) => w.plan === "pro" && w.status === "active");
  const hasReachedFreeWorkspaceLimit = !isProOwner && ownedWorkspaces.length >= 1;
  const activeIsPro =
    unlimited ||
    hasProAccess(supaProfile, activeWorkspace?.plan) ||
    (activeWorkspace?.plan === "pro" && activeWorkspace.status === "active");
  const planBadge = unlimited ? "unlimited" : isProOwner ? "pro" : "free";
  const paidCheckoutEnabled = isPaidCheckoutEnabled();

  const selectWorkspace = useCallback(
    (id: string) => {
      setActiveWorkspaceId(id);
      setPanels(["home"]);
    },
    [setActiveWorkspaceId],
  );

  const clearWorkspaceSelection = useCallback(() => {
    setActiveWorkspaceId(null);
    setPanels([]);
  }, [setActiveWorkspaceId]);

  const openPanel = useCallback((id: TeamPanelId) => {
    if (id === "home") {
      setPanels(["home"]);
      return;
    }
    setPanels(["home", id]);
  }, []);

  const closeLastPanel = useCallback(() => {
    setPanels((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.slice(0, -1);
    });
  }, []);

  /** Esc stack: close rightmost panel → clear WS → caller closes team view. Returns true if handled. */
  const handleEscape = useCallback((): boolean => {
    if (panels.length > 1) {
      closeLastPanel();
      return true;
    }
    if (activeWorkspaceId) {
      clearWorkspaceSelection();
      return true;
    }
    return false;
  }, [panels.length, activeWorkspaceId, closeLastPanel, clearWorkspaceSelection]);

  const refreshWorkspaces = useCallback(async () => {
    if (!userId) {
      return;
    }
    setLoading(true);
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
    } catch (e) {
      console.error("listWorkspaces:", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setPanels([]);
      return;
    }
    setPanels((prev) => (prev.length === 0 ? ["home"] : prev));
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!supaProfile?.email) {
      setMyInvites([]);
      return;
    }
    const email = supaProfile.email.trim().toLowerCase();
    void listMyPendingInvites(email).then(setMyInvites).catch(console.error);

    const channel = supabase
      .channel(`my-invites-${email}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "workspace_invites",
          filter: `email=eq.${email}`,
        },
        () => {
          toastInfo(lang === "ko" ? "새로운 워크스페이스 초대가 도착했습니다!" : "New workspace invitation received!");
          void listMyPendingInvites(email).then(setMyInvites).catch(console.error);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supaProfile?.email, lang]);

  const refreshMembersAndInvites = useCallback(async (wsId: string) => {
    try {
      const [mList, iList] = await Promise.all([listMembers(wsId), listInvites(wsId)]);
      setMembers(mList);
      setInvites(iList.filter((inv) => inv.status === "pending"));
    } catch (e) {
      console.error("refreshMembersAndInvites:", e);
    }
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setMembers([]);
      setInvites([]);
      return;
    }
    void refreshMembersAndInvites(activeWorkspaceId);
  }, [activeWorkspaceId, refreshMembersAndInvites]);

  const handleCheckout = useCallback(async () => {
    if (!paidCheckoutEnabled) {
      toastInfo(lang === "ko" ? "유료 결제는 아직 제공되지 않습니다." : "Paid checkout is not available yet.");
      return;
    }
    if (!activeWorkspaceId) {
      toastError(lang === "ko" ? "먼저 워크스페이스를 선택하세요." : "Select a workspace first.");
      return;
    }
    try {
      const url = isLocalSupabaseUrl()
        ? localDevCheckoutUrl(LEMON_CHECKOUT_URL, activeWorkspaceId)
        : await fetchHostedCheckoutUrl(activeWorkspaceId);
      if (!url) {
        toastError(lang === "ko" ? "결제 페이지를 여는 데 실패했습니다." : "Failed to open checkout page.");
        return;
      }
      await commands.openExternalUrl(url);
    } catch (e) {
      console.error("checkout failed", e);
      toastError(lang === "ko" ? "결제 페이지를 여는 데 실패했습니다." : "Failed to open checkout page.");
    }
  }, [activeWorkspaceId, lang, paidCheckoutEnabled]);

  const openBilling = useCallback(() => {
    if (!activeWorkspaceId) {
      toastError(lang === "ko" ? "먼저 워크스페이스를 선택하세요." : "Select a workspace first.");
      return;
    }
    openPanel("billing");
  }, [activeWorkspaceId, lang, openPanel]);

  const handleCreateWorkspace = async () => {
    if (!userId || !newWorkspaceName.trim()) {
      return;
    }
    if (hasReachedFreeWorkspaceLimit) {
      toastInfo(
        paidCheckoutEnabled
          ? lang === "ko"
            ? "Free는 소유 워크스페이스 1개와 좌석 3명입니다. 다른 워크스페이스를 만들려면 Team Pro(좌석 5명)로 업그레이드하세요."
            : "Free includes 1 owned workspace and 3 seats. Upgrade to Team Pro (5 seats) to create another workspace."
          : lang === "ko"
            ? "Free 플랜에서는 워크스페이스를 1개만 만들 수 있습니다."
            : "Free plan allows 1 owned workspace.",
      );
      if (paidCheckoutEnabled) {
        const targetId = activeWorkspaceId ?? ownedWorkspaces[0]?.id;
        if (targetId) {
          setActiveWorkspaceId(targetId);
          setPanels(["home", "billing"]);
        } else {
          void handleCheckout();
        }
      }
      return;
    }
    setCreating(true);
    try {
      const workspace = await createWorkspace(newWorkspaceName.trim(), userId);
      setWorkspaces((prev) => [workspace, ...prev]);
      selectWorkspace(workspace.id);
      setNewWorkspaceName("");
      toastSuccess(lang === "ko" ? "워크스페이스가 생성되었습니다." : "Workspace created.");
    } catch (e) {
      console.error("createWorkspace:", e);
      toastError(lang === "ko" ? "워크스페이스 생성에 실패했습니다." : "Failed to create workspace.");
    } finally {
      setCreating(false);
    }
  };

  const handleInvite = async () => {
    if (!userId || !activeWorkspaceId || !inviteEmail.trim()) {
      return;
    }
    if (!guard.canInvite) {
      if (!isWorkspaceAdmin) {
        toastError(
          lang === "ko" ? "초대 권한이 없습니다. Owner·Admin만 초대할 수 있습니다." : "Only Owner or Admin can invite.",
        );
        return;
      }
      if (guard.isSeatFull) {
        toastInfo(
          paidCheckoutEnabled
            ? lang === "ko"
              ? `현재 워크스페이스 정원(${guard.memberCount}/${guard.seatLimit}명)이 가득 찼습니다. Team Pro는 좌석 5명입니다.`
              : `Seat limit reached (${guard.memberCount}/${guard.seatLimit}). Team Pro includes 5 seats.`
            : lang === "ko"
              ? `현재 워크스페이스 정원(${guard.memberCount}/${guard.seatLimit}명)이 가득 찼습니다.`
              : `Seat limit reached (${guard.memberCount}/${guard.seatLimit}).`,
        );
        if (paidCheckoutEnabled) {
          openBilling();
        }
      } else if (guard.isLocked) {
        toastError(lang === "ko" ? "워크스페이스가 비활성 상태입니다." : "This workspace is inactive.");
        if (paidCheckoutEnabled) {
          openBilling();
        }
      }
      return;
    }

    setInviting(true);
    try {
      await inviteMember(activeWorkspaceId, inviteEmail.trim(), userId);
      setInviteEmail("");
      await refreshMembersAndInvites(activeWorkspaceId);
      toastSuccess(
        lang === "ko"
          ? "초대를 보냈습니다. 상대방 앱의 초대 목록에서 수락할 수 있습니다."
          : "Invite sent. The recipient can accept it from their invite inbox.",
      );
    } catch (e) {
      console.error("inviteMember:", e);
      toastError(lang === "ko" ? "초대 전송에 실패했습니다." : "Failed to send invite.");
    } finally {
      setInviting(false);
    }
  };

  const handleCreateShareableInvite = async () => {
    if (!userId || !activeWorkspaceId) {
      return;
    }
    if (!guard.canInvite) {
      if (!isWorkspaceAdmin) {
        toastError(
          lang === "ko" ? "초대 권한이 없습니다. Owner·Admin만 초대할 수 있습니다." : "Only Owner or Admin can invite.",
        );
        return;
      }
      if (guard.isSeatFull) {
        toastInfo(
          lang === "ko"
            ? `현재 워크스페이스 정원(${guard.memberCount}/${guard.seatLimit}명)이 가득 찼습니다.`
            : `Seat limit reached (${guard.memberCount}/${guard.seatLimit}).`,
        );
        if (paidCheckoutEnabled) {
          openBilling();
        }
      }
      return;
    }

    setInviting(true);
    try {
      const inv = await createShareableInvite(activeWorkspaceId, userId);
      await refreshMembersAndInvites(activeWorkspaceId);
      try {
        await navigator.clipboard.writeText(inv.token);
        toastSuccess(
          lang === "ko"
            ? `공유용 초대 토큰이 생성되고 복사되었습니다: ${inv.token}`
            : `Shareable invite token created and copied: ${inv.token}`,
        );
      } catch {
        toastSuccess(
          lang === "ko"
            ? `공유용 초대 토큰이 생성되었습니다: ${inv.token}`
            : `Shareable invite token created: ${inv.token}`,
        );
      }
    } catch (e) {
      console.error("createShareableInvite:", e);
      toastError(lang === "ko" ? "공유 토큰 생성에 실패했습니다." : "Failed to create shareable token.");
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!activeWorkspaceId) {
      return;
    }
    try {
      await revokeInvite(inviteId);
      await refreshMembersAndInvites(activeWorkspaceId);
      toastInfo(lang === "ko" ? "초대 토큰이 만료/철회 처리되었습니다." : "Invite token revoked.");
    } catch (e) {
      console.error("revokeInvite:", e);
      toastError(lang === "ko" ? "토큰 만료 처리에 실패했습니다." : "Failed to revoke invite.");
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      toastSuccess(lang === "ko" ? "초대 토큰이 클립보드에 복사되었습니다." : "Invite token copied to clipboard.");
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      toastError(lang === "ko" ? "복사에 실패했습니다." : "Failed to copy.");
    }
  };

  const handleAcceptMyInvite = async (inv: MyPendingInvite) => {
    if (!userId) {
      return;
    }
    setProcessingInviteId(inv.id);
    try {
      await acceptInvite(inv.token);
      setMyInvites((prev) => prev.filter((item) => item.id !== inv.id));
      await refreshWorkspaces();
      selectWorkspace(inv.workspace_id);
      toastSuccess(
        lang === "ko"
          ? `${inv.workspaces?.name ?? "워크스페이스"} 초대를 수락했습니다!`
          : `Joined ${inv.workspaces?.name ?? "workspace"}!`,
      );
    } catch (e: unknown) {
      console.error("handleAcceptMyInvite:", e);
      const errMsg = (e as { message?: string })?.message || (e as { details?: string })?.details;
      toastError(
        lang === "ko"
          ? `초대 수락 실패: ${errMsg || "알 수 없는 오류"}`
          : `Failed to accept invite: ${errMsg || "Unknown error"}`,
      );
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleDeclineMyInvite = async (inviteId: string) => {
    setProcessingInviteId(inviteId);
    try {
      await declineInvite(inviteId);
      setMyInvites((prev) => prev.filter((item) => item.id !== inviteId));
      toastInfo(lang === "ko" ? "초대를 거절했습니다." : "Invite declined.");
    } catch (e: unknown) {
      console.error("handleDeclineMyInvite:", e);
      toastError(lang === "ko" ? "초대 거절에 실패했습니다." : "Failed to decline invite.");
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleAcceptInvite = async () => {
    if (!userId || !inviteToken.trim()) {
      return;
    }
    setAccepting(true);
    try {
      const member = await acceptInvite(inviteToken.trim());
      setInviteToken("");
      await refreshWorkspaces();
      selectWorkspace(member.workspace_id);
      toastSuccess(lang === "ko" ? "초대를 수락했습니다." : "Invite accepted.");
    } catch (e: unknown) {
      console.error("acceptInvite:", e);
      const errMsg = (e as { message?: string })?.message || (e as { details?: string })?.details;
      toastError(
        lang === "ko"
          ? `초대 수락 실패: ${errMsg || "알 수 없는 오류"}`
          : `Failed to accept invite: ${errMsg || "Unknown error"}`,
      );
    } finally {
      setAccepting(false);
    }
  };

  const openSync = () => {
    if (!activeWorkspaceId) {
      toastError(lang === "ko" ? "먼저 워크스페이스를 선택하세요." : "Select a workspace first.");
      return;
    }
    if (!guard.canSync) {
      toastError(
        lang === "ko" ? "이 워크스페이스는 동기화를 사용할 수 없습니다." : "Sync is not available for this workspace.",
      );
      if (paidCheckoutEnabled) {
        openBilling();
      }
      return;
    }
    openPanel("sync");
  };

  const handleExecuteSync = async (
    action: "push" | "pull",
    options: WorkspaceSyncOptions,
    opts?: { stayOpen?: boolean },
  ) => {
    if (!userId || !activeWorkspaceId) {
      return;
    }
    setSyncing(action);
    try {
      if (action === "push") {
        await pushWorkspaceSync(activeWorkspaceId, userId, options);
        toastSuccess(
          lang === "ko" ? "선택한 항목을 워크스페이스에 업로드했습니다." : "Pushed selected items to workspace.",
        );
      } else {
        await pullWorkspaceSync(activeWorkspaceId, options);
        toastSuccess(lang === "ko" ? "선택한 항목을 로컬에 가져왔습니다." : "Pulled selected items from workspace.");
      }
      if (!opts?.stayOpen) {
        closeLastPanel();
      }
      return true;
    } catch (e: unknown) {
      console.error("handleExecuteSync:", e);
      const errMsg = (e as { message?: string })?.message;
      toastError(lang === "ko" ? `동기화 실패: ${errMsg || "오류 발생"}` : `Sync failed: ${errMsg || "Unknown error"}`);
      return false;
    } finally {
      setSyncing(null);
    }
  };

  const handleRenameWorkspace = async (name: string): Promise<boolean> => {
    if (!activeWorkspaceId || !name.trim()) {
      return false;
    }
    setRenamingWorkspace(true);
    try {
      const updated = await updateWorkspace(activeWorkspaceId, { name: name.trim() });
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      toastSuccess(lang === "ko" ? "워크스페이스 이름을 변경했습니다." : "Workspace renamed.");
      return true;
    } catch (e: unknown) {
      console.error("handleRenameWorkspace:", e);
      const errMsg = (e as { message?: string })?.message;
      toastError(lang === "ko" ? `이름 변경 실패: ${errMsg || "오류"}` : `Rename failed: ${errMsg || "Unknown error"}`);
      return false;
    } finally {
      setRenamingWorkspace(false);
    }
  };

  const handleDeleteWorkspace = async (): Promise<boolean> => {
    if (!activeWorkspaceId) {
      return false;
    }
    setDeletingWorkspace(true);
    try {
      await deleteWorkspace(activeWorkspaceId);
      setWorkspaces((prev) => prev.filter((w) => w.id !== activeWorkspaceId));
      clearWorkspaceSelection();
      toastSuccess(lang === "ko" ? "워크스페이스를 삭제했습니다." : "Workspace deleted.");
      return true;
    } catch (e: unknown) {
      console.error("handleDeleteWorkspace:", e);
      const errMsg = (e as { message?: string })?.message;
      toastError(lang === "ko" ? `삭제 실패: ${errMsg || "오류"}` : `Delete failed: ${errMsg || "Unknown error"}`);
      return false;
    } finally {
      setDeletingWorkspace(false);
    }
  };

  const handleRemoveMember = async (memberId: string): Promise<boolean> => {
    if (!activeWorkspaceId || !isWorkspaceOwner) {
      return false;
    }
    setRemovingMemberId(memberId);
    try {
      await removeMember(memberId);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      toastSuccess(lang === "ko" ? "멤버를 제거했습니다." : "Member removed.");
      return true;
    } catch (e: unknown) {
      console.error("handleRemoveMember:", e);
      const errMsg = (e as { message?: string })?.message;
      toastError(lang === "ko" ? `멤버 제거 실패: ${errMsg || "오류"}` : `Remove failed: ${errMsg || "Unknown error"}`);
      return false;
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleTransferOwnership = async (newOwnerProfileId: string, memberLabel: string): Promise<boolean> => {
    if (!activeWorkspaceId || !isWorkspaceOwner || !userId) {
      return false;
    }
    setTransferringOwnership(true);
    try {
      const updated = await transferWorkspaceOwnership(activeWorkspaceId, newOwnerProfileId);
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      await refreshMembersAndInvites(activeWorkspaceId);
      toastSuccess(
        lang === "ko" ? `${memberLabel}님에게 Owner 권한을 넘겼습니다.` : `Ownership transferred to ${memberLabel}.`,
      );
      return true;
    } catch (e: unknown) {
      console.error("handleTransferOwnership:", e);
      const errMsg = (e as { message?: string })?.message;
      toastError(
        lang === "ko" ? `Owner 넘기기 실패: ${errMsg || "오류"}` : `Transfer failed: ${errMsg || "Unknown error"}`,
      );
      return false;
    } finally {
      setTransferringOwnership(false);
    }
  };

  const handleSetMemberRole = async (memberId: string, role: "admin" | "member"): Promise<boolean> => {
    if (!activeWorkspaceId || !isWorkspaceOwner) {
      return false;
    }
    setUpdatingMemberRoleId(memberId);
    try {
      const updated = await setMemberRole(activeWorkspaceId, memberId, role);
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: updated.role } : m)));
      toastSuccess(
        lang === "ko"
          ? role === "admin"
            ? "Admin으로 지정했습니다."
            : "Admin 권한을 해제했습니다."
          : role === "admin"
            ? "Member promoted to Admin."
            : "Admin role removed.",
      );
      return true;
    } catch (e: unknown) {
      console.error("handleSetMemberRole:", e);
      const errMsg = (e as { message?: string })?.message;
      toastError(
        lang === "ko" ? `권한 변경 실패: ${errMsg || "오류"}` : `Role update failed: ${errMsg || "Unknown error"}`,
      );
      return false;
    } finally {
      setUpdatingMemberRoleId(null);
    }
  };

  return {
    lang: lang === "en" ? ("en" as const) : ("ko" as const),
    userId,
    supaProfile,
    workspaces,
    members,
    invites,
    myInvites,
    loading,
    newWorkspaceName,
    setNewWorkspaceName,
    creating,
    inviteEmail,
    setInviteEmail,
    inviting,
    syncing,
    inviteToken,
    setInviteToken,
    accepting,
    processingInviteId,
    copiedToken,
    renamingWorkspace,
    deletingWorkspace,
    removingMemberId,
    transferringOwnership,
    updatingMemberRoleId,
    activeWorkspaceId,
    activeWorkspace,
    isWorkspaceOwner,
    isWorkspaceAdmin,
    currentMemberRole: currentMembership?.role ?? null,
    guard,
    ownedWorkspaces,
    unlimited,
    hasReachedFreeWorkspaceLimit,
    activeIsPro,
    planBadge,
    paidCheckoutEnabled,
    panels,
    selectWorkspace,
    clearWorkspaceSelection,
    openPanel,
    closeLastPanel,
    handleEscape,
    handleCheckout,
    openBilling,
    handleCreateWorkspace,
    handleInvite,
    handleCreateShareableInvite,
    handleRevokeInvite,
    handleCopyToken,
    handleAcceptMyInvite,
    handleDeclineMyInvite,
    handleAcceptInvite,
    openSync,
    handleExecuteSync,
    handleRenameWorkspace,
    handleDeleteWorkspace,
    handleRemoveMember,
    handleTransferOwnership,
    handleSetMemberRole,
  };
}

export type TeamWorkspaceController = ReturnType<typeof useTeamWorkspace>;
