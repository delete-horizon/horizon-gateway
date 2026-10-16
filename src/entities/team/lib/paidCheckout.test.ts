import { describe, expect, it, vi } from "vitest";

const invokeCheckout = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ data: null as unknown, error: null as unknown })),
);
const logClientFailure = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));

vi.mock("@/shared/lib/appLog", () => ({ logClientFailure }));

// Node 20 has no global WebSocket. supabase-js constructs RealtimeClient at
// import time, and that package is external to Vitest, so a mock of
// @supabase/realtime-js never replaces the constructor. Stub the client module
// the app imports instead, including the realtime surface paid checkout touches.
vi.mock("@/shared/api/supabase", () => {
  class RealtimeClient {
    connect() {}
    disconnect() {}
    setAuth(_token?: string) {}
    channel() {
      return {};
    }
    getChannels() {
      return [];
    }
    removeChannel() {
      return "ok";
    }
    removeAllChannels() {
      return [];
    }
  }
  return {
    supabase: {
      realtime: new RealtimeClient(),
      functions: {
        invoke: invokeCheckout,
      },
    },
  };
});

import { hmacSha256Hex } from "../../../../supabase/functions/_shared/webhookSignature.ts";
import {
  checkoutUrlFromFunctionPayload,
  describeCheckoutFailure,
  fetchHostedCheckoutUrl,
  localDevCheckoutUrl,
} from "./paidCheckout";

const workspaceId = "142b1dfb-cae3-4c56-b5c7-54a3b4036b37";
const base = "https://horizon-gateway.lemonsqueezy.com/checkout/buy/variant";

describe("paid checkout URLs", () => {
  it("accepts only a Lemon URL whose signature is bound to the workspace", async () => {
    const sig = await hmacSha256Hex("test-webhook-secret", workspaceId);
    const url = `${base}?checkout[custom][workspace_id]=${workspaceId}&checkout[custom][workspace_sig]=${sig}`;
    expect(checkoutUrlFromFunctionPayload({ url }, workspaceId)).toBe(url);
    expect(checkoutUrlFromFunctionPayload({ url: "https://evil.example/phish" }, workspaceId)).toBeNull();
    expect(checkoutUrlFromFunctionPayload({ url: "javascript:alert(1)" }, workspaceId)).toBeNull();
  });

  it("builds an unsigned local URL and rejects a bad workspace id", () => {
    const url = localDevCheckoutUrl(base, workspaceId);
    expect(url).toContain("checkout[custom][workspace_id]=");
    expect(url).not.toContain("workspace_sig");
    expect(localDevCheckoutUrl(base, "not-a-uuid")).toBeNull();
  });

  it("logs the invoke status without the response body", async () => {
    const response = new Response(JSON.stringify({ error: "forbidden", email: "buyer@example.com" }), { status: 403 });
    invokeCheckout.mockResolvedValueOnce({ data: null, error: { context: response } });
    await expect(fetchHostedCheckoutUrl(workspaceId)).resolves.toBeNull();
    expect(logClientFailure).toHaveBeenCalledWith({
      function: "create-checkout",
      reason: "not_admin",
      status: 403,
      workspaceId,
    });
    expect(JSON.stringify(logClientFailure.mock.calls)).not.toContain("buyer@example.com");
  });

  it("logs an unbound checkout payload without the url", async () => {
    invokeCheckout.mockResolvedValueOnce({ data: { url: "https://evil.example/checkout/buy/secret" }, error: null });
    await expect(fetchHostedCheckoutUrl(workspaceId)).resolves.toBeNull();
    expect(logClientFailure).toHaveBeenCalledWith({
      function: "create-checkout",
      reason: "unbound_url",
      status: null,
      workspaceId,
    });
    expect(JSON.stringify(logClientFailure.mock.calls)).not.toContain("evil.example");
  });

  it("does not keep an unknown error string", async () => {
    const response = new Response(JSON.stringify({ error: "Authorization: Bearer secret-token" }), { status: 500 });
    await expect(describeCheckoutFailure({ context: response })).resolves.toEqual({
      reason: "unavailable",
      status: 500,
    });
  });
});
