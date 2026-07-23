import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    variant: {
      findMany: findManyMock,
    },
  },
}));

import { buildReorderList, reorderListToCsv } from "../../app/services/inventory/reorder-list.server";

describe("buildReorderList", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("builds rows with urgency sorting and summary metrics", async () => {
    findManyMock.mockResolvedValue([
      {
        id: 1,
        forecastDaily: 2,
        salesVelocity7d: 2,
        salesVelocity30d: 1,
        reorderSuggestionQty: 10,
        inventoryQuantity: 4,
        sku: "SKU-1",
        product: {
          title: "Product A",
          classification: "FAST_MOVING",
          supplier: { name: "Supplier A", leadTimeDays: 3 },
        },
        inventoryLevels: [
          {
            locationId: 10,
            available: 4,
            location: { name: "Main" },
          },
        ],
        inventoryAlerts: [{ alertLevel: "LOW", locationId: 10 }],
      },
      {
        id: 2,
        forecastDaily: 0,
        salesVelocity7d: 0,
        salesVelocity30d: 0,
        reorderSuggestionQty: 0,
        inventoryQuantity: 20,
        sku: "SKU-2",
        product: {
          title: "Product B",
          classification: "SLOW_MOVING",
          supplier: null,
        },
        inventoryLevels: [],
        inventoryAlerts: [],
      },
    ]);

    const result = await buildReorderList({ merchantId: 1 });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.productTitle).toBe("Product A");
    expect(result.summary.totalVariants).toBe(2);
    expect(result.summary.needsReorder).toBe(1);
    expect(result.summary.deadStockCount).toBe(1);
  });

  it("filters dead stock rows only", async () => {
    findManyMock.mockResolvedValue([
      {
        id: 1,
        forecastDaily: 0,
        salesVelocity7d: 0,
        salesVelocity30d: 0,
        reorderSuggestionQty: 0,
        inventoryQuantity: 5,
        sku: "SKU-1",
        product: {
          title: "Dead product",
          classification: "SLOW_MOVING",
          supplier: null,
        },
        inventoryLevels: [],
        inventoryAlerts: [],
      },
      {
        id: 2,
        forecastDaily: 1,
        salesVelocity7d: 1,
        salesVelocity30d: 1,
        reorderSuggestionQty: 5,
        inventoryQuantity: 2,
        sku: "SKU-2",
        product: {
          title: "Active product",
          classification: "FAST_MOVING",
          supplier: null,
        },
        inventoryLevels: [],
        inventoryAlerts: [],
      },
    ]);

    const result = await buildReorderList({
      merchantId: 1,
      deadStockOnly: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.isDeadStock).toBe(true);
  });
});

describe("reorderListToCsv", () => {
  it("exports csv with headers and escaped values", () => {
    const csv = reorderListToCsv([
      {
        variantId: 1,
        productTitle: 'Product "A"',
        sku: "SKU-1",
        locationId: null,
        locationName: null,
        inventoryQuantity: 4,
        velocity7d: 2,
        velocity30d: 1,
        forecastDaily: 1.5,
        reorderSuggestionQty: 10,
        daysOfCover: 2.67,
        stockoutDate: "2026-01-03T00:00:00.000Z",
        orderByDate: "2026-01-01T00:00:00.000Z",
        urgencyScore: 80,
        alertLevel: "LOW",
        classification: "FAST_MOVING",
        supplierName: "Supplier A",
        supplierLeadTimeDays: 2,
        sellThroughRate: 0.4,
        isDeadStock: false,
      },
    ]);

    expect(csv).toContain("Product,SKU,Location");
    expect(csv).toContain('"Product ""A"""');
    expect(csv).toContain("FAST_MOVING");
    expect(csv).toContain("no");
  });
});
