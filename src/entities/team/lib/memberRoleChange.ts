import type { WorkspaceRole } from "../types";

export type MemberRoleDenial =
  | "raise_own_role"
  | "not_manager"
  | "change_own_role"
  | "admin_target_privileged"
  | "admin_promote"
  | "owner_drop_below_admin";

/** Mirrors `guard_workspace_member_write` role checks in the billing RLS migration. */
export function decideMemberRoleChange(input: {
  callerIsWorkspaceOwner: boolean;
  callerIsAdmin: boolean;
  callerId: string;
  targetProfileId: string;
  targetIsWorkspaceOwner: boolean;
  targetRole: WorkspaceRole;
  nextRole: WorkspaceRole;
}): { ok: true } | { ok: false; reason: MemberRoleDenial } {
  const isSelf = input.callerId === input.targetProfileId;
  if (input.callerIsWorkspaceOwner) {
    if (isSelf && input.nextRole !== "owner" && input.nextRole !== "admin") {
      return { ok: false, reason: "owner_drop_below_admin" };
    }
    return { ok: true };
  }

  if (
    isSelf &&
    ((input.targetRole === "member" && (input.nextRole === "admin" || input.nextRole === "owner")) ||
      (input.targetRole === "admin" && input.nextRole === "owner"))
  ) {
    return { ok: false, reason: "raise_own_role" };
  }

  if (!input.callerIsAdmin) {
    return { ok: false, reason: "not_manager" };
  }

  if (isSelf) {
    return { ok: false, reason: "change_own_role" };
  }

  if (input.targetIsWorkspaceOwner || input.targetRole === "owner" || input.targetRole === "admin") {
    return { ok: false, reason: "admin_target_privileged" };
  }

  if (input.nextRole === "owner" || input.nextRole === "admin") {
    return { ok: false, reason: "admin_promote" };
  }

  return { ok: true };
}

export function memberRoleDenialMessage(reason: MemberRoleDenial): string {
  switch (reason) {
    case "raise_own_role":
      return "Cannot raise your own role";
    case "not_manager":
      return "Only a workspace owner or admin can change member roles";
    case "change_own_role":
      return "Cannot change your own role";
    case "admin_target_privileged":
      return "Admins cannot change the owner or another admin";
    case "admin_promote":
      return "Admins cannot promote a member to owner or admin";
    case "owner_drop_below_admin":
      return "The workspace owner cannot drop below admin";
  }
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === "owner" || value === "admin" || value === "member";
}
