import { describe, expect, it } from "vitest";
import { ProductClassification } from "@prisma/client";
import {
  computeDaysOfCover,
  computeOrderByDate,
  computeSellThroughRate,
  computeStockHealthScore,
  computeStockoutDate,
  computeUrgencyScore,
  isDeadStock,
} from "../../app/services/inventory/inventory-metrics.server";

describe("computeDaysOfCover", () => {
  it("returns null when forecast is zero", () => {
    expect(computeDaysOfCover(10, 0)).toBeNull();
  });

  it("computes days of cover from inventory and forecast", () => {
    expect(computeDaysOfCover(20, 4)).toBe(5);
  });
});

describe("computeStockoutDate", () => {
  it("returns null when forecast is zero", () => {
    expect(computeStockoutDate(10, 0, new Date("2026-01-01"))).toBeNull();
  });

  it("adds rounded-up days of cover to the base date", () => {
    const stockoutDate = computeStockoutDate(20, 4, new Date("2026-01-01"));
    expect(stockoutDate?.toISOString().slice(0, 10)).toBe("2026-01-06");
  });
});

describe("computeOrderByDate", () => {
  it("returns null when stockout date is missing", () => {
    expect(computeOrderByDate(null, 5)).toBeNull();
  });

  it("subtracts lead time from stockout date", () => {
    const orderByDate = computeOrderByDate(new Date("2026-01-10"), 3);
    expect(orderByDate?.toISOString().slice(0, 10)).toBe("2026-01-07");
  });
});

describe("computeUrgencyScore", () => {
  it("caps score at 100 for critical out-of-stock SKUs", () => {
    const score = computeUrgencyScore({
      daysOfCover: 1,
      alertLevel: "OUT_OF_STOCK",
      classification: ProductClassification.FAST_MOVING,
      reorderSuggestionQty: 25,
    });

    expect(score).toBe(100);
  });

  it("adds lower urgency for healthy stock", () => {
    const score = computeUrgencyScore({
      daysOfCover: 30,
      alertLevel: null,
      classification: ProductClassification.STABLE,
      reorderSuggestionQty: 0,
    });

    expect(score).toBe(0);
  });
});

describe("computeStockHealthScore", () => {
  it("returns 100 when there are no variants", () => {
    expect(computeStockHealthScore(0, 0)).toBe(100);
  });

  it("computes percentage of healthy variants", () => {
    expect(computeStockHealthScore(10, 2)).toBe(80);
  });
});

describe("computeSellThroughRate", () => {
  it("returns null when there is no inventory movement", () => {
    expect(computeSellThroughRate(0, 0)).toBeNull();
  });

  it("computes sell-through ratio", () => {
    expect(computeSellThroughRate(30, 70)).toBe(0.3);
  });
});

describe("isDeadStock", () => {
  it("flags inventory with no recent sales", () => {
    expect(isDeadStock(0, 12)).toBe(true);
  });

  it("does not flag sold-through inventory", () => {
    expect(isDeadStock(5, 0)).toBe(false);
  });
});
