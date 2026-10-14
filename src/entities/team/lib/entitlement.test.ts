import { describe, expect, it } from "vitest";
import type { DBProfile } from "@/entities/app";
import { getTeamEntitlement, hasProAccess, isUnlimitedTeam } from "./entitlement";

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

describe("team entitlement", () => {
  it("reads pro and unlimited flags and ignores everything else", () => {
    expect(getTeamEntitlement(profile("pro"))).toBe("pro");
    expect(getTeamEntitlement(profile("unlimited"))).toBe("unlimited");
    expect(getTeamEntitlement(profile(null))).toBeNull();
    expect(getTeamEntitlement(null)).toBeNull();
    expect(getTeamEntitlement(undefined)).toBeNull();
  });

  it("grants pro access from a pro or unlimited flag, or from a pro workspace plan", () => {
    expect(hasProAccess(profile("pro"), "free")).toBe(true);
    expect(hasProAccess(profile("unlimited"), null)).toBe(true);
    expect(hasProAccess(null, "pro")).toBe(true);
    expect(hasProAccess(profile(null), "free")).toBe(false);
    expect(hasProAccess(null, "free")).toBe(false);
    expect(hasProAccess(undefined)).toBe(false);
  });

  it("treats only the unlimited flag as an unlimited team", () => {
    expect(isUnlimitedTeam(profile("unlimited"))).toBe(true);
    expect(isUnlimitedTeam(profile("pro"))).toBe(false);
    expect(isUnlimitedTeam(profile(null))).toBe(false);
    expect(isUnlimitedTeam(null)).toBe(false);
  });
});
