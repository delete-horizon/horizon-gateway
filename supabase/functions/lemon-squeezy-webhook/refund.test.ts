import { describe, expect, it } from "vitest";
import { earlierEndsAt, normalizeBuyerEmail, planLemonPayload } from "./refund";

const SEATS: Record<string, number> = { "1987632": 5 };
const NOW = "2026-10-14T03:00:00.000Z";

describe("normalizeBuyerEmail", () => {
  it("trims and lowercases the buyer email", () => {
    expect(normalizeBuyerEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });

  it("rejects empty and non-email values", () => {
    expect(normalizeBuyerEmail("  ")).toBeNull();
    expect(normalizeBuyerEmail("not-an-email")).toBeNull();
    expect(normalizeBuyerEmail(null)).toBeNull();
  });
});

describe("earlierEndsAt", () => {
  it("keeps the earlier license end so a refund cannot extend retention", () => {
    expect(earlierEndsAt(null, "2026-10-01T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z");
    expect(earlierEndsAt("2026-11-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z");
    expect(earlierEndsAt("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("planLemonPayload refunds", () => {
  it("reads the order buyer email, order id, and refund time", () => {
    const plan = planLemonPayload(
      {
        meta: { event_name: "order_refunded" },
        data: {
          id: "42",
          attributes: {
            user_email: "  Buyer@Example.COM ",
            refunded_at: "2026-10-01T12:00:00.000000Z",
            status: "refunded",
          },
        },
      },
      NOW,
      SEATS,
    );
    expect(plan).toEqual({
      kind: "refund",
      email: "buyer@example.com",
      orderId: "42",
      licenseOrderId: "42",
      subscriptionId: null,
      refundedAt: "2026-10-01T12:00:00.000Z",
    });
  });

  it("reads a subscription invoice refund", () => {
    const plan = planLemonPayload(
      {
        meta: { event_name: "subscription_payment_refunded" },
        data: {
          id: 9,
          attributes: {
            user_email: "sub@example.com",
            subscription_id: 77,
            refunded_at: "2026-10-02T00:00:00.000Z",
            status: "refunded",
          },
        },
      },
      NOW,
      SEATS,
    );
    expect(plan).toEqual({
      kind: "refund",
      email: "sub@example.com",
      orderId: "invoice:9",
      licenseOrderId: null,
      subscriptionId: "77",
      refundedAt: "2026-10-02T00:00:00.000Z",
    });
  });
});
