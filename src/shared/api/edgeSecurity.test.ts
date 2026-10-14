import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appendCheckoutParams,
  isBoundCheckoutUrl,
  verifyWorkspaceBinding,
} from "../../../supabase/functions/_shared/checkoutRequest.ts";
import { mapLemonSubscriptionStatus } from "../../../supabase/functions/_shared/lemonSubscription.ts";
import { decideSponsorUpdate, type SponsorSnapshot } from "../../../supabase/functions/_shared/sponsorState.ts";
import {
  hmacSha256Hex,
  timingSafeEqualHex,
  verifyHmacSha256,
} from "../../../supabase/functions/_shared/webhookSignature.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const emptySponsor: SponsorSnapshot = { isSponsor: false, sponsorSince: null, sponsorCycleAt: null };

describe("sponsor webhook decisions", () => {
  const cycle = "2026-01-01T00:00:00.000Z";
  const later = "2026-06-01T00:00:00.000Z";
  const now = "2026-06-02T00:00:00.000Z";

  it("activates a first sponsorship and keeps the original sponsor_since", () => {
    const first = decideSponsorUpdate(emptySponsor, { action: "activate", cycleAt: cycle, tier: "Pro", now });
    expect(first.kind).toBe("apply");
    expect(first.isSponsor).toBe(true);
    expect(first.sponsorSince).toBe(now);
    expect(first.sponsorTier).toBe("Pro");

    const refresh = decideSponsorUpdate(
      { isSponsor: true, sponsorSince: now, sponsorCycleAt: cycle },
      { action: "activate", cycleAt: cycle, tier: "Plus", now: later },
    );
    expect(refresh.kind).toBe("apply");
    expect(refresh.sponsorSince).toBe(now);
    expect(refresh.sponsorTier).toBe("Plus");
  });

  it("ignores a replayed activation after that cycle was cancelled", () => {
    const decision = decideSponsorUpdate(
      { isSponsor: false, sponsorSince: now, sponsorCycleAt: cycle },
      { action: "activate", cycleAt: cycle, tier: "Pro", now: later },
    );
    expect(decision).toEqual({ kind: "ignore" });
  });

  it("ignores a stale cancellation from an older cycle", () => {
    const decision = decideSponsorUpdate(
      { isSponsor: true, sponsorSince: now, sponsorCycleAt: later },
      { action: "cancel", cycleAt: cycle, tier: null, now },
    );
    expect(decision).toEqual({ kind: "ignore" });
  });

  it("applies a newer sponsorship cycle after a cancellation", () => {
    const decision = decideSponsorUpdate(
      { isSponsor: false, sponsorSince: cycle, sponsorCycleAt: cycle },
      { action: "activate", cycleAt: later, tier: "Pro", now },
    );
    expect(decision.kind).toBe("apply");
    expect(decision.isSponsor).toBe(true);
    expect(decision.sponsorCycleAt).toBe(later);
  });

  it("does not grant a sponsor when the cycle timestamp is missing", () => {
    expect(decideSponsorUpdate(emptySponsor, { action: "activate", cycleAt: "nope", tier: "Pro", now })).toEqual({
      kind: "ignore",
    });
  });
});

describe("lemon subscription status", () => {
  it("maps known statuses and refuses unknown ones", () => {
    expect(mapLemonSubscriptionStatus("active")).toBe("active");
    expect(mapLemonSubscriptionStatus("on_trial")).toBe("active");
    expect(mapLemonSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapLemonSubscriptionStatus("cancelled")).toBe("canceled");
    expect(mapLemonSubscriptionStatus("pending")).toBeNull();
    expect(mapLemonSubscriptionStatus("")).toBeNull();
    expect(mapLemonSubscriptionStatus(undefined)).toBeNull();
  });
});

describe("checkout binding", () => {
  const workspaceId = "142b1dfb-cae3-4c56-b5c7-54a3b4036b37";
  const base = "https://horizon-gateway.lemonsqueezy.com/checkout/buy/variant";

  it("keeps Lemon custom-data brackets and rejects non-Lemon URLs", () => {
    const url = appendCheckoutParams(base, { "checkout[custom][workspace_id]": workspaceId });
    expect(url).toContain("checkout[custom][workspace_id]=");
    expect(url).not.toContain("%5B");
    expect(appendCheckoutParams("http://horizon-gateway.lemonsqueezy.com/checkout/buy/x", {})).toBeNull();
    expect(appendCheckoutParams("https://evil.example/checkout", {})).toBeNull();
  });

  it("round-trips the workspace signature and rejects a swapped workspace", async () => {
    const secret = "test-webhook-secret";
    const sig = await hmacSha256Hex(secret, workspaceId);
    const url = appendCheckoutParams(base, {
      "checkout[custom][workspace_id]": workspaceId,
      "checkout[custom][workspace_sig]": sig,
    });
    expect(url).toBeTruthy();
    expect(isBoundCheckoutUrl(url as string, workspaceId)).toBe(true);
    expect(await verifyWorkspaceBinding(secret, workspaceId, sig)).toBe(true);
    expect(await verifyWorkspaceBinding(secret, "00000000-0000-4000-8000-000000000001", sig)).toBe(false);
  });
});

describe("webhook signature compare", () => {
  it("accepts equal digests regardless of hex case and rejects everything else", async () => {
    const digest = "ab".repeat(32);
    expect(timingSafeEqualHex(digest, digest.toUpperCase())).toBe(true);
    expect(timingSafeEqualHex(digest, `${digest.slice(0, -1)}c`)).toBe(false);
    expect(timingSafeEqualHex(digest, "abc")).toBe(false);
    expect(await verifyHmacSha256("", "body", digest)).toBe(false);
    expect(await verifyHmacSha256("secret", "body", digest)).toBe(false);
  });
});

describe("client and migration boundaries", () => {
  it("does not reference the service role from client or website source", () => {
    const hits: string[] = [];
    for (const dir of ["src", "website/src"]) {
      walk(path.join(root, dir), (file) => {
        if (!/\.(ts|tsx|js|mjs|astro)$/.test(file) || file.endsWith(".test.ts")) {
          return;
        }
        const text = readFileSync(file, "utf8");
        if (/service_role|SERVICE_ROLE/i.test(text)) {
          hits.push(path.relative(root, file));
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("keeps checkout on the user JWT and webhooks on signatures", () => {
    const checkout = readFileSync(path.join(root, "supabase/functions/create-checkout/index.ts"), "utf8");
    const config = readFileSync(path.join(root, "supabase/config.toml"), "utf8");
    const migration = readFileSync(
      path.join(root, "supabase/migrations/20261014031500_security_review_billing_rls.sql"),
      "utf8",
    );
    expect(checkout).not.toMatch(/SERVICE_ROLE/);
    expect(checkout).toContain("auth.getUser");
    expect(checkout).toContain("consume_user_rate_limit");
    expect(config).toMatch(/\[functions\.create-checkout\]\s+verify_jwt = true/);
    expect(config).toMatch(/\[functions\.lemon-squeezy-webhook\]\s+verify_jwt = false/);
    expect(config).toMatch(/\[functions\.github-sponsors-webhook\]\s+verify_jwt = false/);
    expect(migration).not.toMatch(/or status = 'pending'/);
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on private.api_rate_limits");
    expect(migration).toContain("team_entitlement := null");
  });
});

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
      continue;
    }
    visit(full);
  }
}
