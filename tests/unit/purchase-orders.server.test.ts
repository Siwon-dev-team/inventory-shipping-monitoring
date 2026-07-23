import { beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus } from "@prisma/client";

const {
  findFirstMock,
  findUniqueMock,
  updateMock,
  upsertMock,
  aggregateMock,
  adjustShopifyInventoryMock,
  monitorVariantQuantityMock,
  recomputeMerchantForecastsMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  upsertMock: vi.fn(),
  aggregateMock: vi.fn(),
  adjustShopifyInventoryMock: vi.fn(),
  monitorVariantQuantityMock: vi.fn(),
  recomputeMerchantForecastsMock: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    purchaseOrder: {
      findFirst: findFirstMock,
      update: updateMock,
    },
    settings: {
      findUnique: findUniqueMock,
    },
    variant: {
      findFirst: findFirstMock,
      update: updateMock,
    },
    variantInventory: {
      upsert: upsertMock,
      aggregate: aggregateMock,
    },
    location: {
      findFirst: findFirstMock,
    },
  },
}));

vi.mock("../../app/services/inventory/inventory-receive.server", () => ({
  adjustShopifyInventory: adjustShopifyInventoryMock,
  toInventoryItemGid: (id: string) => `gid://shopify/InventoryItem/${id}`,
  toLocationGid: (id: string) => `gid://shopify/Location/${id}`,
}));

vi.mock("../../app/services/inventory/monitor.server", () => ({
  monitorVariantQuantity: monitorVariantQuantityMock,
}));

vi.mock("../../app/services/inventory/forecast.server", () => ({
  recomputeMerchantForecasts: recomputeMerchantForecastsMock,
}));

import { markPurchaseOrderReceived } from "../../app/services/inventory/purchase-orders.server";

describe("markPurchaseOrderReceived", () => {
  const admin = { graphql: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();

    findFirstMock
      .mockResolvedValueOnce({
        id: 1,
        merchantId: 10,
        status: PurchaseOrderStatus.SENT,
        lines: [
          {
            id: 100,
            variantId: 5,
            locationId: 3,
            quantity: 12,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 5,
        sku: "SKU-1",
        shopifyInventoryItemId: "999",
        inventoryQuantity: 4,
        product: { id: 1, title: "Product A", classification: "STABLE" },
        inventoryLevels: [
          {
            locationId: 3,
            location: { id: 3, shopifyLocationId: "loc-1", name: "Main" },
          },
        ],
      });

    findUniqueMock.mockResolvedValue({
      monitoringEnabled: true,
      globalLowThreshold: 5,
      globalCriticalThreshold: 2,
      safetyBufferDays: 5,
    });

    upsertMock.mockResolvedValue({
      id: 1,
      variantId: 5,
      locationId: 3,
      available: 16,
    });

    aggregateMock.mockResolvedValue({ _sum: { available: 16 } });

    updateMock.mockResolvedValue({
      id: 1,
      status: PurchaseOrderStatus.RECEIVED,
      lines: [],
      supplier: null,
    });

    adjustShopifyInventoryMock.mockResolvedValue(undefined);
    monitorVariantQuantityMock.mockResolvedValue(undefined);
    recomputeMerchantForecastsMock.mockResolvedValue({ variantsUpdated: 1, productsUpdated: 1 });
  });

  it("adjusts Shopify inventory and marks PO received", async () => {
    await markPurchaseOrderReceived(1, 10, admin);

    expect(adjustShopifyInventoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: 12,
        reason: "received",
      }),
    );
    expect(upsertMock).toHaveBeenCalled();
    expect(monitorVariantQuantityMock).toHaveBeenCalled();
    expect(recomputeMerchantForecastsMock).toHaveBeenCalledWith(10);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PurchaseOrderStatus.RECEIVED,
        }),
      }),
    );
  });

  it("rejects receive when PO is already received", async () => {
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue({
      id: 1,
      merchantId: 10,
      status: PurchaseOrderStatus.RECEIVED,
      lines: [],
    });

    await expect(markPurchaseOrderReceived(1, 10, admin)).rejects.toThrow(
      "Only draft or sent purchase orders can be received.",
    );
  });
});
