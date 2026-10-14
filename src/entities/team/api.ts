import type { Json } from "@/shared/api/database.types";
import { supabase } from "@/shared/api/supabase";
import { decideMemberRoleChange, isWorkspaceRole, memberRoleDenialMessage } from "./lib/memberRoleChange";
import type {
  ResourceKind,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceResource,
  WorkspaceRole,
} from "./types";

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase.from("workspaces").select("*").order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as Workspace[];
}

export async function createWorkspace(name: string, ownerId?: string): Promise<Workspace> {
  const { data: userData } = await supabase.auth.getUser();
  const effectiveOwnerId = userData?.user?.id ?? ownerId;
  if (!effectiveOwnerId) {
    throw new Error("User must be authenticated to create a workspace");
  }

  const { data, error } = await supabase
    .from("workspaces")
    .insert({ name, owner_id: effectiveOwnerId, plan: "free", seat_limit: 3 })
    .select()
    .single();

  if (error) {
    throw error;
  }
  // Owner is also granted a `workspace_members` row so member listings/RLS include them.
  const { error: memberError } = await supabase
    .from("workspace_members")
    .upsert(
      { workspace_id: data.id, profile_id: effectiveOwnerId, role: "owner" },
      { onConflict: "workspace_id,profile_id" },
    );
  if (memberError) {
    console.error("createWorkspace: failed to upsert owner membership:", memberError.message);
  }
  return data as Workspace;
}

export async function updateWorkspace(workspaceId: string, patch: { name: string }): Promise<Workspace> {
  const { data, error } = await supabase
    .from("workspaces")
    .update({ name: patch.name.trim() })
    .eq("id", workspaceId)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as Workspace;
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const { error } = await supabase.from("workspaces").delete().eq("id", workspaceId);
  if (error) {
    throw error;
  }
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.from("workspace_members").delete().eq("id", memberId);
  if (error) {
    throw error;
  }
}

export async function transferWorkspaceOwnership(workspaceId: string, newOwnerProfileId: string): Promise<Workspace> {
  const { data: userData } = await supabase.auth.getUser();
  const currentOwnerId = userData?.user?.id;
  if (!currentOwnerId) {
    throw new Error("User must be authenticated");
  }
  if (newOwnerProfileId === currentOwnerId) {
    throw new Error("Cannot transfer ownership to yourself");
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspaceId)
    .single();
  if (workspaceError || !workspace) {
    throw workspaceError ?? new Error("Workspace not found");
  }
  if (workspace.owner_id !== currentOwnerId) {
    throw new Error("Only the workspace owner can transfer ownership");
  }

  const { data: targetMember, error: targetError } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("profile_id", newOwnerProfileId)
    .maybeSingle();
  if (targetError) {
    throw targetError;
  }
  if (!targetMember) {
    throw new Error("Target user is not a workspace member");
  }

  // Promote first while the caller is still owner_id. The billing trigger
  // rejects an owner_id change until the target membership role is owner,
  // and the old owner can no longer update members after the transfer.
  const { error: promoteError } = await supabase
    .from("workspace_members")
    .update({ role: "owner" })
    .eq("workspace_id", workspaceId)
    .eq("profile_id", newOwnerProfileId);
  if (promoteError) {
    throw promoteError;
  }

  const { error: demoteError } = await supabase
    .from("workspace_members")
    .update({ role: "admin" })
    .eq("workspace_id", workspaceId)
    .eq("profile_id", currentOwnerId);
  if (demoteError) {
    throw demoteError;
  }

  const { data: updated, error: updateError } = await supabase
    .from("workspaces")
    .update({ owner_id: newOwnerProfileId })
    .eq("id", workspaceId)
    .eq("owner_id", currentOwnerId)
    .select()
    .single();
  if (updateError) {
    throw updateError;
  }

  return updated as Workspace;
}

export async function setMemberRole(
  workspaceId: string,
  memberId: string,
  role: "admin" | "member",
): Promise<WorkspaceMember> {
  const { data: userData } = await supabase.auth.getUser();
  const currentUserId = userData?.user?.id;
  if (!currentUserId) {
    throw new Error("User must be authenticated");
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspaceId)
    .single();
  if (workspaceError || !workspace) {
    throw workspaceError ?? new Error("Workspace not found");
  }
  const callerIsWorkspaceOwner = workspace.owner_id === currentUserId;
  let callerIsAdmin = false;
  if (!callerIsWorkspaceOwner) {
    const { data: callerMember, error: callerError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("profile_id", currentUserId)
      .maybeSingle();
    if (callerError) {
      throw callerError;
    }
    callerIsAdmin = callerMember?.role === "admin";
  }

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("profile_id, role")
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .single();
  if (memberError || !member || !isWorkspaceRole(member.role)) {
    throw memberError ?? new Error("Member not found");
  }

  const decision = decideMemberRoleChange({
    callerIsWorkspaceOwner,
    callerIsAdmin,
    callerId: currentUserId,
    targetProfileId: member.profile_id,
    targetIsWorkspaceOwner: member.profile_id === workspace.owner_id,
    targetRole: member.role,
    nextRole: role,
  });
  if (!decision.ok) {
    throw new Error(memberRoleDenialMessage(decision.reason));
  }

  const { data: updated, error: updateError } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("id", memberId)
    .select()
    .single();
  if (updateError) {
    throw updateError;
  }
  return updated as WorkspaceMember;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  // Older workspaces sometimes have owner_id set without a workspace_members row.
  // Only the owner can insert their own row (RLS: profile_id = auth.uid()).
  await ensureOwnerMembership(workspaceId);

  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      `
      *,
      profile:profiles (
        email,
        display_name,
        avatar_url
      )
    `,
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("listMembers profile join failed, falling back:", error.message);
    const fallback = await supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (fallback.error) {
      throw fallback.error;
    }
    return await withSyntheticOwner(workspaceId, (fallback.data ?? []) as WorkspaceMember[]);
  }
  return await withSyntheticOwner(workspaceId, (data ?? []) as WorkspaceMember[]);
}

/** If owner is still missing from members (RLS blocked repair), append a display-only row. */
async function withSyntheticOwner(workspaceId: string, members: WorkspaceMember[]): Promise<WorkspaceMember[]> {
  const { data: workspace } = await supabase.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
  const ownerId = workspace?.owner_id as string | undefined;
  if (!ownerId) {
    return members;
  }
  if (members.some((m) => m.profile_id === ownerId)) {
    return members.map((m) => (m.profile_id === ownerId && m.role !== "owner" ? { ...m, role: "owner" as const } : m));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, display_name, avatar_url")
    .eq("id", ownerId)
    .maybeSingle();

  const synthetic: WorkspaceMember = {
    id: `synthetic-owner:${workspaceId}`,
    workspace_id: workspaceId,
    profile_id: ownerId,
    role: "owner",
    created_at: new Date(0).toISOString(),
    profile: profile
      ? {
          email: profile.email ?? null,
          display_name: profile.display_name ?? null,
          avatar_url: profile.avatar_url ?? null,
        }
      : null,
  };
  return [synthetic, ...members];
}

/** Ensure current user, if they are the workspace owner, has a workspace_members row. */
export async function ensureOwnerMembership(workspaceId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) {
    return;
  }

  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (wsError || !workspace?.owner_id || workspace.owner_id !== uid) {
    return;
  }

  const { data: existing } = await supabase
    .from("workspace_members")
    .select("id, role")
    .eq("workspace_id", workspaceId)
    .eq("profile_id", uid)
    .maybeSingle();

  if (existing?.role === "owner") {
    return;
  }

  const { error } = await supabase
    .from("workspace_members")
    .upsert({ workspace_id: workspaceId, profile_id: uid, role: "owner" }, { onConflict: "workspace_id,profile_id" });
  if (error) {
    console.warn("ensureOwnerMembership failed:", error.message);
  }
}

export async function inviteMember(
  workspaceId: string,
  email: string,
  invitedBy?: string,
  role: WorkspaceRole = "member",
): Promise<WorkspaceInvite> {
  const { data: userData } = await supabase.auth.getUser();
  const effectiveInvitedBy = userData?.user?.id ?? invitedBy ?? null;

  const token = crypto.randomUUID();
  const { data, error } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email: email.trim().toLowerCase(),
      role,
      invited_by: effectiveInvitedBy,
      token,
      status: "pending",
    })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as WorkspaceInvite;
}

export async function createShareableInvite(
  workspaceId: string,
  invitedBy?: string,
  role: WorkspaceRole = "member",
): Promise<WorkspaceInvite> {
  const { data: userData } = await supabase.auth.getUser();
  const effectiveInvitedBy = userData?.user?.id ?? invitedBy ?? null;

  const token = crypto.randomUUID();
  const { data, error } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email: "link@shareable",
      role,
      invited_by: effectiveInvitedBy,
      token,
      status: "pending",
    })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as WorkspaceInvite;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.from("workspace_invites").update({ status: "revoked" }).eq("id", inviteId);
  if (error) {
    throw error;
  }
}

export async function listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
  const { data, error } = await supabase
    .from("workspace_invites")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as WorkspaceInvite[];
}

function inviteClientError(message: string): Error {
  const normalized = message.toLowerCase();
  if (normalized.includes("rate limit")) {
    return new Error("Too many attempts. Try again later.");
  }
  if (normalized.includes("seat limit")) {
    return new Error("Seat limit reached.");
  }
  if (normalized.includes("not active")) {
    return new Error("This workspace is not accepting members.");
  }
  if (normalized.includes("authentication required")) {
    return new Error("User must be authenticated to accept an invite");
  }
  return new Error("Invite not found or already used.");
}

export async function acceptInvite(token: string): Promise<WorkspaceMember> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user?.id) {
    throw new Error("User must be authenticated to accept an invite");
  }

  const { data, error } = await supabase.rpc("accept_workspace_invite", { invite_token: token.trim() });
  if (error) {
    console.error("acceptInvite failed");
    throw inviteClientError(error.message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invite not found or already used.");
  }
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string") {
    throw inviteClientError(record.error);
  }
  if (typeof record.id !== "string" || typeof record.workspace_id !== "string") {
    throw new Error("Invite not found or already used.");
  }
  return record as unknown as WorkspaceMember;
}

export interface MyPendingInvite extends WorkspaceInvite {
  workspaces?: { name: string } | null;
}

export async function listMyPendingInvites(userEmail: string): Promise<MyPendingInvite[]> {
  if (!userEmail) {
    return [];
  }
  const { data, error } = await supabase
    .from("workspace_invites")
    .select("*, workspaces(name)")
    .eq("email", userEmail.trim().toLowerCase())
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as MyPendingInvite[];
}

export async function declineInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.from("workspace_invites").update({ status: "revoked" }).eq("id", inviteId);
  if (error) {
    throw error;
  }
}

export async function pushResources(
  workspaceId: string,
  kind: ResourceKind,
  payload: unknown,
  updatedBy?: string,
): Promise<WorkspaceResource> {
  const { data: userData } = await supabase.auth.getUser();
  const effectiveUpdatedBy = userData?.user?.id ?? updatedBy ?? null;

  const { data, error } = await supabase
    .from("workspace_resources")
    .upsert(
      {
        workspace_id: workspaceId,
        kind,
        payload: payload as Json,
        updated_by: effectiveUpdatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,kind" },
    )
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as WorkspaceResource;
}

export async function pullResources(workspaceId: string, kind?: ResourceKind): Promise<WorkspaceResource[]> {
  let query = supabase.from("workspace_resources").select("*").eq("workspace_id", workspaceId);
  if (kind) {
    query = query.eq("kind", kind);
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return (data ?? []) as WorkspaceResource[];
}

async function mutateWorkspaceResourcePayload(
  workspaceId: string,
  kind: ResourceKind,
  mutate: (items: unknown[]) => unknown[],
): Promise<WorkspaceResource> {
  const rows = await pullResources(workspaceId, kind);
  const current = rows[0]?.payload;
  const list = Array.isArray(current) ? [...current] : [];
  const next = mutate(list);
  return pushResources(workspaceId, kind, next);
}

function itemIdOf(item: unknown): string | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const id = (item as { id?: unknown }).id;
  if (id === null || id === undefined) {
    return null;
  }
  return String(id);
}

function linkRefOf(item: unknown): string | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const domainId = (item as { domain_id?: unknown }).domain_id;
  const groupId = (item as { group_id?: unknown }).group_id;
  if (domainId == null || groupId == null) {
    return null;
  }
  return `${domainId}:${groupId}`;
}

function matchesResourceItem(kind: ResourceKind, item: unknown, targetId: string): boolean {
  if (kind === "domain_group_links") {
    return linkRefOf(item) === targetId;
  }
  return itemIdOf(item) === targetId;
}

/** Remove one item from a workspace resource payload by id (Admin+). */
export async function deleteRemoteResourceItem(
  workspaceId: string,
  kind: ResourceKind,
  itemId: string | number,
): Promise<WorkspaceResource> {
  const target = String(itemId);
  return mutateWorkspaceResourcePayload(workspaceId, kind, (items) =>
    items.filter((item) => !matchesResourceItem(kind, item, target)),
  );
}

export interface UpsertRemoteResourceOptions {
  /** When editing identity fields (e.g. link domain/group), remove this id first. */
  replaceId?: string | number;
}

/** Insert or replace one item in a workspace resource payload by id (Admin+). */
export async function upsertRemoteResourceItem(
  workspaceId: string,
  kind: ResourceKind,
  item: Record<string, unknown>,
  options?: UpsertRemoteResourceOptions,
): Promise<WorkspaceResource> {
  return mutateWorkspaceResourcePayload(workspaceId, kind, (items) => {
    let next = items;
    if (options?.replaceId != null) {
      const replaceTarget = String(options.replaceId);
      next = next.filter((row) => !matchesResourceItem(kind, row, replaceTarget));
    }

    if (kind === "domain_group_links") {
      const domainId = Number(item.domain_id);
      const groupId = Number(item.group_id);
      if (!Number.isFinite(domainId) || !Number.isFinite(groupId)) {
        return next;
      }
      const link = { domain_id: domainId, group_id: groupId };
      const linkKey = `${domainId}:${groupId}`;
      next = next.filter((row) => linkRefOf(row) !== linkKey);
      return [...next, link];
    }

    const target = itemIdOf(item);
    if (target == null) {
      return [...next, item];
    }
    const idx = next.findIndex((x) => itemIdOf(x) === target);
    if (idx >= 0) {
      const updated = [...next];
      updated[idx] = { ...(next[idx] as object), ...item };
      return updated;
    }
    return [...next, item];
  });
}
