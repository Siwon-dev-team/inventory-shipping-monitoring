import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureMerchantSetupMock = vi.fn();
const markWebhookProcessedMock = vi.fn();
const recomputeMerchantForecastsMock = vi.fn();
const findFirstMock = vi.fn();
const upsertMock = vi.fn();
const createMock = vi.fn();
const webhookMock = vi.fn();

vi.mock("../../app/services/merchant-setup.server", () => ({
  ensureMerchantSetup: ensureMerchantSetupMock,
}));

vi.mock("../../app/services/webhook-idempotency.server", () => ({
  markWebhookProcessed: markWebhookProcessedMock,
}));

vi.mock("../../app/services/inventory/forecast.server", () => ({
  recomputeMerchantForecasts: recomputeMerchantForecastsMock,
}));

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    webhook: webhookMock,
  },
}));

vi.mock("../../app/db.server", () => ({
  default: {
    variant: {
      findFirst: findFirstMock,
    },
    salesData: {
      upsert: upsertMock,
      create: createMock,
    },
  },
}));

describe("webhooks.orders.create action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMerchantSetupMock.mockResolvedValue({ id: 1, shopDomain: "demo.myshopify.com" });
    recomputeMerchantForecastsMock.mockResolvedValue(undefined);
  });

  it("ignores duplicate webhook delivery id", async () => {
    webhookMock.mockResolvedValue({
      topic: "ORDERS_CREATE",
      shop: "demo.myshopify.com",
      payload: { id: 123, line_items: [] },
    });
    markWebhookProcessedMock.mockResolvedValue(false);

    const { action } = await import("../../app/routes/webhooks.orders.create");
    const request = new Request("https://example.test/webhooks/orders/create", {
      method: "POST",
      headers: {
        "x-shopify-webhook-id": "duplicate-id",
      },
    });
    const response = await action({ request } as never);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("Duplicate webhook ignored");
    expect(recomputeMerchantForecastsMock).not.toHaveBeenCalled();
  });

  it("upserts sales rows and recomputes forecasts for new deliveries", async () => {
    webhookMock.mockResolvedValue({
      topic: "ORDERS_CREATE",
      shop: "demo.myshopify.com",
      payload: {
        id: 456,
        created_at: "2026-04-20T10:00:00.000Z",
        line_items: [{ variant_id: 111, quantity: 2 }],
      },
    });
    markWebhookProcessedMock.mockResolvedValue(true);
    findFirstMock.mockResolvedValue({ id: 99, merchantId: 1 });
    upsertMock.mockResolvedValue(undefined);

    const { action } = await import("../../app/routes/webhooks.orders.create");
    const request = new Request("https://example.test/webhooks/orders/create", {
      method: "POST",
      headers: {
        "x-shopify-webhook-id": "new-delivery-id",
      },
    });
    const response = await action({ request } as never);

    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    expect(recomputeMerchantForecastsMock).toHaveBeenCalledWith(1);
  });
});

