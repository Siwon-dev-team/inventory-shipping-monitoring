import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookMock = vi.fn();
const ensureMerchantSetupMock = vi.fn();
const markWebhookProcessedMock = vi.fn();
const upsertProductMock = vi.fn();
const upsertVariantMock = vi.fn();

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    webhook: webhookMock,
  },
}));

vi.mock("../../app/services/merchant-setup.server", () => ({
  ensureMerchantSetup: ensureMerchantSetupMock,
}));

vi.mock("../../app/services/webhook-idempotency.server", () => ({
  markWebhookProcessed: markWebhookProcessedMock,
}));

vi.mock("../../app/db.server", () => ({
  default: {
    product: {
      upsert: upsertProductMock,
    },
    variant: {
      upsert: upsertVariantMock,
    },
  },
}));

describe("webhooks.products.update action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMerchantSetupMock.mockResolvedValue({ id: 1, shopDomain: "store-a.myshopify.com" });
    upsertProductMock.mockResolvedValue({ id: 100 });
  });

  it("skips duplicate webhook deliveries", async () => {
    webhookMock.mockResolvedValue({
      topic: "PRODUCTS_UPDATE",
      shop: "store-a.myshopify.com",
      payload: { id: 1, title: "Product A", variants: [] },
    });
    markWebhookProcessedMock.mockResolvedValue(false);

    const { action } = await import("../../app/routes/webhooks.products.update");
    const request = new Request("https://example.test/webhooks/products/update", {
      method: "POST",
      headers: { "x-shopify-webhook-id": "dup-1" },
    });

    const response = await action({ request } as never);
    expect(response.status).toBe(200);
    expect(upsertProductMock).not.toHaveBeenCalled();
  });

  it("upserts product and variants for new deliveries", async () => {
    webhookMock.mockResolvedValue({
      topic: "PRODUCTS_UPDATE",
      shop: "store-a.myshopify.com",
      payload: {
        id: 1,
        title: "Product A",
        variants: [{ id: 11, sku: "SKU-11", inventory_quantity: 2 }],
      },
    });
    markWebhookProcessedMock.mockResolvedValue(true);

    const { action } = await import("../../app/routes/webhooks.products.update");
    const request = new Request("https://example.test/webhooks/products/update", {
      method: "POST",
      headers: { "x-shopify-webhook-id": "delivery-1" },
    });

    const response = await action({ request } as never);
    expect(response.status).toBe(200);
    expect(upsertProductMock).toHaveBeenCalledTimes(1);
    expect(upsertVariantMock).toHaveBeenCalledTimes(1);
  });
});

