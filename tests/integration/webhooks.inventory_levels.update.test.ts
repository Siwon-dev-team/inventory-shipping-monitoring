import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookMock = vi.fn();
const ensureMerchantSetupMock = vi.fn();
const markWebhookProcessedMock = vi.fn();
const findFirstMock = vi.fn();
const upsertLocationMock = vi.fn();
const upsertInventoryMock = vi.fn();
const aggregateInventoryMock = vi.fn();
const updateVariantMock = vi.fn();
const monitorVariantQuantityMock = vi.fn();

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

vi.mock("../../app/services/inventory/monitor.server", () => ({
  monitorVariantQuantity: monitorVariantQuantityMock,
}));

vi.mock("../../app/db.server", () => ({
  default: {
    variant: {
      findFirst: findFirstMock,
      update: updateVariantMock,
    },
    location: {
      upsert: upsertLocationMock,
    },
    variantInventory: {
      upsert: upsertInventoryMock,
      aggregate: aggregateInventoryMock,
    },
  },
}));

describe("webhooks.inventory_levels.update action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMerchantSetupMock.mockResolvedValue({ id: 1, shopDomain: "store-a.myshopify.com" });
  });

  it("skips duplicate webhook deliveries", async () => {
    webhookMock.mockResolvedValue({
      topic: "INVENTORY_LEVELS_UPDATE",
      shop: "store-a.myshopify.com",
      payload: {
        inventory_item_id: 777,
        location_id: 10,
        available: 3,
      },
    });
    markWebhookProcessedMock.mockResolvedValue(false);

    const { action } = await import("../../app/routes/webhooks.inventory_levels.update");
    const request = new Request("https://example.test/webhooks/inventory_levels/update", {
      method: "POST",
      headers: { "x-shopify-webhook-id": "duplicate-id" },
    });

    const response = await action({ request } as never);
    expect(response.status).toBe(200);
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(monitorVariantQuantityMock).not.toHaveBeenCalled();
  });

  it("processes valid inventory updates", async () => {
    webhookMock.mockResolvedValue({
      topic: "INVENTORY_LEVELS_UPDATE",
      shop: "store-a.myshopify.com",
      payload: {
        inventory_item_id: 777,
        location_id: 10,
        available: 3,
      },
    });
    markWebhookProcessedMock.mockResolvedValue(true);
    findFirstMock.mockResolvedValue({
      id: 11,
      merchantId: 1,
      product: { id: 21, title: "P1" },
      merchant: { settings: { monitoringEnabled: true, globalLowThreshold: 5 } },
      lowThreshold: null,
      criticalThreshold: null,
      sku: "SKU-1",
    });
    upsertLocationMock.mockResolvedValue({ id: 30, name: "Main" });
    aggregateInventoryMock.mockResolvedValue({ _sum: { available: 3 } });

    const { action } = await import("../../app/routes/webhooks.inventory_levels.update");
    const request = new Request("https://example.test/webhooks/inventory_levels/update", {
      method: "POST",
      headers: { "x-shopify-webhook-id": "delivery-1" },
    });

    const response = await action({ request } as never);
    expect(response.status).toBe(200);
    expect(upsertInventoryMock).toHaveBeenCalledTimes(1);
    expect(updateVariantMock).toHaveBeenCalledTimes(1);
    expect(monitorVariantQuantityMock).toHaveBeenCalledTimes(1);
  });
});

