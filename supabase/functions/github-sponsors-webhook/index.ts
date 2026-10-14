// Supabase Edge Function (Deno): GitHub Sponsors webhook receiver.
//
// Verifies the GitHub webhook signature, stores the body hash in webhook_events
// so an exact replay is a no-op, then updates sponsor columns. A later replay of
// an activation for a sponsorship cycle that was already cancelled is ignored
// (see decideSponsorUpdate). Gateway JWT verification is disabled; GitHub
// cannot send a Supabase JWT.
//
// Apply the billing RLS migration before deploying this function.
// sponsor_cycle_at must exist or the profile update fails and the event is
// released so GitHub can retry.
//
// Required secrets:
//   - GITHUB_SPONSORS_WEBHOOK_SECRET
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { githubId, githubLogin, isRecord } from "../_shared/guards.ts";
import { decideSponsorUpdate } from "../_shared/sponsorState.ts";
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "../_shared/webhookSignature.ts";

const GITHUB_WEBHOOK_SECRET = Deno.env.get("GITHUB_SPONSORS_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MAX_BODY_BYTES = 1_000_000;
const ACTIVATING_ACTIONS = new Set(["created", "tier_changed", "edited"]);
const CANCELLING_ACTIONS = new Set(["cancelled", "pending_cancellation"]);

async function releaseWebhookEvent(eventId: string): Promise<void> {
  try {
    const { error } = await supabase.from("webhook_events").delete().eq("id", eventId);
    if (error) {
      console.error("webhook_events delete failed");
    }
  } catch {
    console.error("webhook_events delete failed");
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }

  const signatureHeader = req.headers.get("x-hub-signature-256") ?? "";
  const [algo, hexSignature] = signatureHeader.split("=");
  if (!GITHUB_WEBHOOK_SECRET || algo !== "sha256" || !hexSignature) {
    return new Response("invalid signature", { status: 401 });
  }
  const computed = await hmacSha256Hex(GITHUB_WEBHOOK_SECRET, rawBody);
  if (!timingSafeEqualHex(computed, hexSignature)) {
    return new Response("invalid signature", { status: 401 });
  }

  if (req.headers.get("x-github-event") !== "sponsorship") {
    return new Response("ignored", { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  if (!isRecord(payload) || typeof payload.action !== "string") {
    return new Response("invalid JSON", { status: 400 });
  }

  const action = payload.action;
  const eventId = await sha256Hex(rawBody);
  const eventName = /^[a-z_]{1,40}$/.test(action) ? `sponsorship_${action}` : "sponsorship_unknown";
  const { error: insertError } = await supabase.from("webhook_events").insert({ id: eventId, event_name: eventName });
  if (insertError) {
    if (insertError.code === "23505") {
      return new Response("duplicate", { status: 200 });
    }
    console.error("webhook_events insert failed");
    return new Response("insert failed", { status: 500 });
  }

  try {
    if (!ACTIVATING_ACTIONS.has(action) && !CANCELLING_ACTIONS.has(action)) {
      return new Response("ignored", { status: 200 });
    }

    const sponsorship = isRecord(payload.sponsorship) ? payload.sponsorship : null;
    const sponsor = sponsorship && isRecord(sponsorship.sponsor) ? sponsorship.sponsor : null;
    const tier = sponsorship && isRecord(sponsorship.tier) ? sponsorship.tier : null;
    const matchedGithubId = githubId(sponsor?.id);
    const matchedLogin = githubLogin(sponsor?.login);
    const cycleAt = typeof sponsorship?.created_at === "string" ? sponsorship.created_at : "";
    const tierName =
      typeof tier?.name === "string" && tier.name.length <= 80 && !/[\u0000-\u001f]/.test(tier.name) ? tier.name : null;

    if (!matchedGithubId && !matchedLogin) {
      return new Response("ignored", { status: 200 });
    }
    if (!cycleAt) {
      console.warn("sponsors webhook missing sponsorship.created_at");
      return new Response("ignored", { status: 200 });
    }

    let lookup = supabase.from("profiles").select("id, is_sponsor, sponsor_since, sponsor_cycle_at").limit(2);
    lookup = matchedGithubId ? lookup.eq("github_id", matchedGithubId) : lookup.eq("github_login", matchedLogin as string);
    const { data, error: lookupError } = await lookup;
    if (lookupError) {
      console.error("profiles lookup failed");
      await releaseWebhookEvent(eventId);
      return new Response("update failed", { status: 500 });
    }
    if (!data || data.length === 0) {
      console.warn("no matching profile for sponsor");
      return new Response("ok", { status: 200 });
    }
    if (data.length > 1) {
      console.error("multiple profiles matched sponsor identity");
      await releaseWebhookEvent(eventId);
      return new Response("update failed", { status: 500 });
    }

    const row = data[0];
    const decision = decideSponsorUpdate(
      {
        isSponsor: Boolean(row.is_sponsor),
        sponsorSince: row.sponsor_since,
        sponsorCycleAt: row.sponsor_cycle_at,
      },
      {
        action: ACTIVATING_ACTIONS.has(action) ? "activate" : "cancel",
        cycleAt,
        tier: tierName,
        now: new Date().toISOString(),
      },
    );
    if (decision.kind === "ignore") {
      return new Response("ignored", { status: 200 });
    }

    const updates: Record<string, string | boolean | null> = {
      is_sponsor: decision.isSponsor === true,
      sponsor_cycle_at: decision.sponsorCycleAt ?? cycleAt,
    };
    if (decision.sponsorTier !== undefined) {
      updates.sponsor_tier = decision.sponsorTier;
    }
    if (decision.sponsorSince !== undefined) {
      updates.sponsor_since = decision.sponsorSince;
    }

    const { error: updateError, count } = await supabase
      .from("profiles")
      .update(updates, { count: "exact" })
      .eq("id", row.id);
    if (updateError || count === 0) {
      console.error("profiles update failed");
      await releaseWebhookEvent(eventId);
      return new Response("update failed", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch {
    console.error("webhook processing failed");
    await releaseWebhookEvent(eventId);
    return new Response("processing failed", { status: 500 });
  }
});
