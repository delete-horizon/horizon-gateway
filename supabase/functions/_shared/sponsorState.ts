export interface SponsorSnapshot {
  isSponsor: boolean;
  sponsorSince: string | null;
  sponsorCycleAt: string | null;
}

export type SponsorAction = "activate" | "cancel";

export interface SponsorDecision {
  kind: "ignore" | "apply";
  isSponsor?: boolean;
  /** Undefined means "leave the stored tier alone" (cancellations). */
  sponsorTier?: string | null;
  sponsorSince?: string | null;
  sponsorCycleAt?: string;
}

function epoch(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * GitHub signs the body only, so a captured delivery can be replayed.
 * Exact duplicates are dropped by `webhook_events`. This decides whether a
 * different delivery for the same sponsorship cycle may change sponsor state.
 *
 * A cancellation that is stored, followed by a replay of the original
 * activation for that same cycle, is ignored once `sponsor_since` is set.
 * A cancellation that arrives before any activation (`sponsor_since` still
 * null) still allows that cycle's activation through, so a reordered first
 * delivery is not stuck off. Verifying the live sponsorship with the GitHub
 * API would close that remaining case.
 */
export function decideSponsorUpdate(
  current: SponsorSnapshot,
  event: { action: SponsorAction; cycleAt: string; tier: string | null; now: string },
): SponsorDecision {
  const cycleMs = epoch(event.cycleAt);
  if (cycleMs === null || epoch(event.now) === null) {
    return { kind: "ignore" };
  }
  const currentMs = epoch(current.sponsorCycleAt);

  if (event.action === "cancel") {
    if (currentMs !== null && cycleMs < currentMs) {
      return { kind: "ignore" };
    }
    return {
      kind: "apply",
      isSponsor: false,
      sponsorCycleAt: event.cycleAt,
    };
  }

  if (currentMs !== null && cycleMs < currentMs) {
    return { kind: "ignore" };
  }
  if (currentMs !== null && cycleMs === currentMs && !current.isSponsor && current.sponsorSince) {
    return { kind: "ignore" };
  }

  return {
    kind: "apply",
    isSponsor: true,
    sponsorTier: event.tier,
    sponsorSince: current.sponsorSince ?? event.now,
    sponsorCycleAt: event.cycleAt,
  };
}
