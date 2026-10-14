// Supabase Edge Function (Deno): Lemon Squeezy subscription webhook receiver.
//
// Verifies the Lemon Squeezy webhook signature, records the raw body in
// `webhook_events` (sha256 hex id) so a replay returns 200 without reprocessing,
// then updates `workspaces.status` / `workspaces.seat_limit` from `subscription_*`
// events, matched via the `checkout[custom][workspace_id]` value echoed back as
// `meta.custom_data.workspace_id`. If processing after the insert fails, the event
// row is deleted so Lemon Squeezy's retry is processed again instead of treated
// as a duplicate.
//
// Required secrets (set via `supabase secrets set`):
//   - LEMON_SQUEEZY_WEBHOOK_SECRET — the signing secret configured on the LS webhook
//   - SUPABASE_URL                 — usually auto-provided in the Edge Function runtime
//   - SUPABASE_SERVICE_ROLE_KEY    — service role key (bypasses RLS; keep secret!)
//
// Lemon Squeezy webhook setup: Store settings -> Webhooks
//   - URL: https://<project-ref>.supabase.co/functions/v1/lemon-squeezy-webhook
//   - Events: subscription_created, subscription_updated, subscription_cancelled,
//             subscription_expired, subscription_resumed, subscription_paused
//
// Checkout must pass `checkout[custom][workspace_id]=<uuid>` (see
// `src/entities/team/ui/TeamSection.tsx` and VITE_LEMON_SQUEEZY_CHECKOUT_URL) so this
// function knows which workspace to update.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleLemonSqueezyWebhook, type WebhookSupabase } from "./handler.ts";

const LEMON_SQUEEZY_WEBHOOK_SECRET = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve((req) =>
  handleLemonSqueezyWebhook(req, {
    supabase: supabase as unknown as WebhookSupabase,
    webhookSecret: LEMON_SQUEEZY_WEBHOOK_SECRET,
  }),
);
