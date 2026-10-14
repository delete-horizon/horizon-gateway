import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../../../../supabase/functions/_shared/webhookSignature.ts";
import { checkoutUrlFromFunctionPayload, localDevCheckoutUrl } from "./paidCheckout";

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
});
