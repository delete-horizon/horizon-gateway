import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideMemberRoleChange, type MemberRoleDenial } from "./memberRoleChange";

const ownerId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const otherAdminId = "33333333-3333-4333-8333-333333333333";
const memberId = "44444444-4444-4444-8444-444444444444";

function decide(overrides: Partial<Parameters<typeof decideMemberRoleChange>[0]>) {
  return decideMemberRoleChange({
    callerIsWorkspaceOwner: false,
    callerIsAdmin: false,
    callerId: memberId,
    targetProfileId: memberId,
    targetIsWorkspaceOwner: false,
    targetRole: "member",
    nextRole: "member",
    ...overrides,
  });
}

function denied(reason: MemberRoleDenial) {
  return { ok: false, reason };
}

describe("member role changes", () => {
  it("lets the owner promote a regular member to admin", () => {
    expect(
      decide({
        callerIsWorkspaceOwner: true,
        callerId: ownerId,
        targetProfileId: memberId,
        targetRole: "member",
        nextRole: "admin",
      }),
    ).toEqual({ ok: true });
  });

  it("lets the owner demote an admin to member", () => {
    expect(
      decide({
        callerIsWorkspaceOwner: true,
        callerId: ownerId,
        targetProfileId: otherAdminId,
        targetRole: "admin",
        nextRole: "member",
      }),
    ).toEqual({ ok: true });
  });

  it("lets the owner promote a member to owner", () => {
    expect(
      decide({
        callerIsWorkspaceOwner: true,
        callerId: ownerId,
        targetProfileId: memberId,
        targetRole: "member",
        nextRole: "owner",
      }),
    ).toEqual({ ok: true });
  });

  it("lets the owner demote their own membership to admin", () => {
    expect(
      decide({
        callerIsWorkspaceOwner: true,
        callerId: ownerId,
        targetProfileId: ownerId,
        targetIsWorkspaceOwner: true,
        targetRole: "owner",
        nextRole: "admin",
      }),
    ).toEqual({ ok: true });
  });

  it("lets an admin update a regular member without granting a higher role", () => {
    expect(
      decide({
        callerIsAdmin: true,
        callerId: adminId,
        targetProfileId: memberId,
        targetRole: "member",
        nextRole: "member",
      }),
    ).toEqual({ ok: true });
  });

  it("blocks an admin promoting a regular member to admin", () => {
    expect(
      decide({
        callerIsAdmin: true,
        callerId: adminId,
        targetProfileId: memberId,
        targetRole: "member",
        nextRole: "admin",
      }),
    ).toEqual(denied("admin_promote"));
  });

  it("blocks an admin promoting anyone to owner", () => {
    expect(
      decide({
        callerIsAdmin: true,
        callerId: adminId,
        targetProfileId: memberId,
        targetRole: "member",
        nextRole: "owner",
      }),
    ).toEqual(denied("admin_promote"));
  });

  it("blocks an admin changing the owner's role", () => {
    expect(
      decide({
        callerIsAdmin: true,
        callerId: adminId,
        targetProfileId: ownerId,
        targetIsWorkspaceOwner: true,
        targetRole: "owner",
        nextRole: "member",
      }),
    ).toEqual(denied("admin_target_privileged"));
  });

  it("blocks an admin changing another admin's role", () => {
    expect(
      decide({
        callerIsAdmin: true,
        callerId: adminId,
        targetProfileId: otherAdminId,
        targetRole: "admin",
        nextRole: "member",
      }),
    ).toEqual(denied("admin_target_privileged"));
  });

  it("blocks an admin raising their own role", () => {
    expect(
      decide({
        callerIsAdmin: true,
        callerId: adminId,
        targetProfileId: adminId,
        targetRole: "admin",
        nextRole: "owner",
      }),
    ).toEqual(denied("raise_own_role"));
  });

  it("blocks a member raising their own role", () => {
    expect(
      decide({
        callerId: memberId,
        targetProfileId: memberId,
        targetRole: "member",
        nextRole: "admin",
      }),
    ).toEqual(denied("raise_own_role"));
  });

  it("blocks a member changing someone else's role", () => {
    expect(
      decide({
        callerId: memberId,
        targetProfileId: otherAdminId,
        targetRole: "admin",
        nextRole: "member",
      }),
    ).toEqual(denied("not_manager"));
  });

  it("blocks an admin changing their own role downward", () => {
    expect(
      decide({
        callerIsAdmin: true,
        callerId: adminId,
        targetProfileId: adminId,
        targetRole: "admin",
        nextRole: "member",
      }),
    ).toEqual(denied("change_own_role"));
  });

  it("blocks the owner dropping their own membership below admin", () => {
    expect(
      decide({
        callerIsWorkspaceOwner: true,
        callerId: ownerId,
        targetProfileId: ownerId,
        targetIsWorkspaceOwner: true,
        targetRole: "owner",
        nextRole: "member",
      }),
    ).toEqual(denied("owner_drop_below_admin"));
  });
});

describe("member role migration contract", () => {
  const migration = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../supabase/migrations/20261014031500_security_review_billing_rls.sql",
    ),
    "utf8",
  );

  it("lets admins through the update policy and keeps the trigger blocks", () => {
    expect(migration).toContain("or public.is_workspace_admin(workspace_members.workspace_id)");
    expect(migration).toContain("cannot raise your own role");
    expect(migration).toContain("admins cannot change the owner or another admin");
    expect(migration).toContain("admins cannot promote a member to owner or admin");
    expect(migration).toContain("only a workspace owner or admin can change roles");
    expect(migration).toContain("the workspace owner cannot drop below admin");
  });

  it("keeps the invite list admin-only", () => {
    expect(migration).toContain('create policy "workspace_invites_select_admin_or_invitee"');
    expect(migration).not.toMatch(/or status = 'pending'/);
    expect(migration).not.toContain("email = 'link@shareable' and status = 'pending'");
  });
});
