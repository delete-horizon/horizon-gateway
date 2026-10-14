import { describe, expect, it } from "vitest";
import type { DBProfile } from "@/entities/app";
import type { Workspace, WorkspaceMember } from "../types";
import { useWorkspaceGuard } from "./useWorkspaceGuard";

function profile(entitlement: DBProfile["team_entitlement"]): DBProfile {
  return {
    id: "profile-1",
    email: "owner@example.com",
    display_name: null,
    avatar_url: null,
    is_sponsor: false,
    sponsor_tier: null,
    created_at: "2026-01-01T00:00:00.000Z",
    team_entitlement: entitlement,
  };
}

function workspace(overrides: Pick<Workspace, "plan" | "seat_limit" | "status">): Workspace {
  return {
    id: "ws-1",
    name: "Team",
    owner_id: "owner-1",
    ls_subscription_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function members(count: number): WorkspaceMember[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `member-${index}`,
    workspace_id: "ws-1",
    profile_id: `profile-${index}`,
    role: index === 0 ? "owner" : "member",
    created_at: "2026-01-01T00:00:00.000Z",
  }));
}

describe("useWorkspaceGuard seats", () => {
  it("allows 3 seats on a free workspace and blocks the next invite", () => {
    const free = workspace({ plan: "free", seat_limit: 3, status: "active" });

    const open = useWorkspaceGuard(free, members(2), null, { canManageTeam: true });
    expect(open.seatLimit).toBe(3);
    expect(open.memberCount).toBe(2);
    expect(open.isSeatFull).toBe(false);
    expect(open.canInvite).toBe(true);
    expect(open.canSync).toBe(true);

    const full = useWorkspaceGuard(free, members(3), null, { canManageTeam: true });
    expect(full.seatLimit).toBe(3);
    expect(full.memberCount).toBe(3);
    expect(full.isSeatFull).toBe(true);
    expect(full.canInvite).toBe(false);
  });

  it("defaults a missing workspace to the free seat limit of 3", () => {
    const guard = useWorkspaceGuard(null, [], null, { canManageTeam: true });
    expect(guard.seatLimit).toBe(3);
    expect(guard.isSeatFull).toBe(false);
    expect(guard.canInvite).toBe(true);
  });

  it("allows 5 seats on a pro workspace and blocks the next invite", () => {
    const pro = workspace({ plan: "pro", seat_limit: 5, status: "active" });

    const open = useWorkspaceGuard(pro, members(4), null, { canManageTeam: true });
    expect(open.seatLimit).toBe(5);
    expect(open.memberCount).toBe(4);
    expect(open.isSeatFull).toBe(false);
    expect(open.canInvite).toBe(true);

    const full = useWorkspaceGuard(pro, members(5), null, { canManageTeam: true });
    expect(full.seatLimit).toBe(5);
    expect(full.memberCount).toBe(5);
    expect(full.isSeatFull).toBe(true);
    expect(full.canInvite).toBe(false);
  });

  it("does not let a pro entitlement flag raise the workspace seat limit", () => {
    const free = workspace({ plan: "free", seat_limit: 3, status: "active" });
    const guard = useWorkspaceGuard(free, members(3), profile("pro"), { canManageTeam: true });

    expect(guard.seatLimit).toBe(3);
    expect(guard.isSeatFull).toBe(true);
    expect(guard.canInvite).toBe(false);
  });

  it("lets the unlimited flag bypass the seat cap", () => {
    const free = workspace({ plan: "free", seat_limit: 3, status: "active" });
    const guard = useWorkspaceGuard(free, members(40), profile("unlimited"), { canManageTeam: true });

    expect(guard.seatLimit).toBe(9999);
    expect(guard.memberCount).toBe(40);
    expect(guard.isSeatFull).toBe(false);
    expect(guard.canInvite).toBe(true);
    expect(guard.isLocked).toBe(false);
    expect(guard.canSync).toBe(true);
  });

  it("still requires team management rights when the unlimited flag is set", () => {
    const pro = workspace({ plan: "pro", seat_limit: 5, status: "active" });
    const guard = useWorkspaceGuard(pro, members(9), profile("unlimited"));

    expect(guard.isSeatFull).toBe(false);
    expect(guard.canInvite).toBe(false);
  });

  it("locks a canceled workspace unless an entitlement flag is set", () => {
    const canceled = workspace({ plan: "free", seat_limit: 3, status: "canceled" });

    const locked = useWorkspaceGuard(canceled, members(1), null, { canManageTeam: true });
    expect(locked.isLocked).toBe(true);
    expect(locked.canInvite).toBe(false);
    expect(locked.canSync).toBe(false);

    const bypassed = useWorkspaceGuard(canceled, members(1), profile("unlimited"), { canManageTeam: true });
    expect(bypassed.isLocked).toBe(false);
    expect(bypassed.canInvite).toBe(true);
    expect(bypassed.canSync).toBe(true);
  });
});
