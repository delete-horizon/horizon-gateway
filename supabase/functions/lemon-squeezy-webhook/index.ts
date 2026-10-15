// Supabase Edge Function (Deno): Lemon Squeezy subscription webhook receiver.
//
// Verifies the Lemon Squeezy webhook signature, records the raw body in
// `webhook_events` (sha256 hex id) so a replay returns 200 without reprocessing,
// then updates workspace billing columns. The workspace id is honored when
// `meta.custom_data.workspace_sig` is an HMAC of that id made with the webhook
// secret (see create-checkout). A present signature must verify. Unsigned
// custom data is ignored after LEGACY_UNSIGNED_CUTOFF (2026-11-15T00:00:00Z,
// overridable with the LEGACY_UNSIGNED_CUTOFF env var). Before that instant a
// UUID-only checkout may still grant the pro plan; refunds and cancellations
// keep the previous rules. Deploy create-checkout, then the app release, then
// this webhook.
// `order_refunded` and `subscription_payment_refunded` also record
// `refund_events` and deactivate the matching license key. If processing after
// the insert fails, the event row is deleted so a retry is processed again.
//
// Refunds do not block future purchases. Repeat refunders are listed in
// `admin_repeat_refunders` for a person to review.
//
// Unknown subscription statuses do not grant an active plan.
//
// Apply the billing RLS migration and the refund_events migration before
// deploying this function. Gateway JWT verification is disabled (config.toml);
// Lemon cannot send a Supabase JWT. This handler requires a valid HMAC instead.
//
// Lemon Squeezy webhook setup: Store settings -> Webhooks
//   - URL: https://<project-ref>.supabase.co/functions/v1/lemon-squeezy-webhook
//   - Events: subscription_created, subscription_updated, subscription_cancelled,
//             subscription_expired, subscription_resumed, subscription_paused,
//             order_refunded, subscription_payment_refunded, license_key_created,
//             license_key_updated
//
// Required secrets:
//   - LEMON_SQUEEZY_WEBHOOK_SECRET
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//
// Optional:
//   - LEGACY_UNSIGNED_CUTOFF — ISO-8601 instant. Defaults to 2026-11-15T00:00:00Z.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleLemonSqueezyWebhook, type WebhookSupabase } from "./handler.ts";

const LEMON_SQUEEZY_WEBHOOK_SECRET = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const legacyUnsignedCutoff = Deno.env.get("LEGACY_UNSIGNED_CUTOFF") ?? "";

Deno.serve((req) =>
  handleLemonSqueezyWebhook(req, {
    supabase: supabase as unknown as WebhookSupabase,
    webhookSecret: LEMON_SQUEEZY_WEBHOOK_SECRET,
    legacyUnsignedCutoff,
  }),
);
