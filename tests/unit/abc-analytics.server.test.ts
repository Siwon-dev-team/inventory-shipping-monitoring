import { describe, expect, it } from "vitest";
import {
  abcAnalyticsToCsv,
  buildAbcAnalyticsRows,
  classifyAbcByVelocity,
} from "../../app/services/inventory/abc-analytics.server";

describe("classifyAbcByVelocity", () => {
  it("classifies top movers as A", () => {
    expect(classifyAbcByVelocity(10, 10)).toBe("A");
  });

  it("classifies slow movers as C", () => {
    expect(classifyAbcByVelocity(1, 10)).toBe("C");
  });
});

describe("buildAbcAnalyticsRows", () => {
  it("sorts rows by ABC class then velocity", () => {
    const rows = buildAbcAnalyticsRows(
      [
        {
          id: 1,
          sku: "A1",
          inventoryQuantity: 5,
          salesVelocity30d: 1,
          product: { title: "Slow", classification: "SLOW_MOVING" },
        },
        {
          id: 2,
          sku: "A2",
          inventoryQuantity: 2,
          salesVelocity30d: 10,
          product: { title: "Fast", classification: "FAST_MOVING" },
        },
      ],
      new Map([
        [1, 0.1],
        [2, 0.8],
      ]),
      new Set([1]),
    );

    expect(rows[0]?.abcClass).toBe("A");
    expect(rows[0]?.productTitle).toBe("Fast");
    expect(rows[1]?.isDeadStock).toBe(true);
  });
});

describe("abcAnalyticsToCsv", () => {
  it("exports csv with headers", () => {
    const csv = abcAnalyticsToCsv([
      {
        variantId: 1,
        productTitle: "Product",
        sku: "SKU-1",
        velocity30d: 2,
        sellThroughRate: 0.4,
        inventoryQuantity: 3,
        classification: "FAST_MOVING",
        abcClass: "A",
        isDeadStock: false,
      },
    ]);

    expect(csv).toContain("ABC class,Product,SKU");
    expect(csv).toContain('"A"');
  });
});
