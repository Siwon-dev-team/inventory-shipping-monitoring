import { describe, expect, it } from "vitest";
import { ProductClassification } from "@prisma/client";
import {
  classifyVariant,
  computeForecastMetrics,
} from "../../app/services/inventory/forecast.server";

describe("computeForecastMetrics", () => {
  it("computes weighted forecast and reorder quantity with safety stock", () => {
    const metrics = computeForecastMetrics({
      sold7d: 42, // 6/day
      sold30d: 120, // 4/day
      inventoryQuantity: 20,
      safetyBufferDays: 5,
    });

    expect(metrics.velocity7d).toBe(6);
    expect(metrics.velocity30d).toBe(4);
    expect(metrics.forecastDaily).toBe(5.2);
    expect(metrics.forecast7d).toBe(36.4);
    expect(metrics.forecast30d).toBe(156);
    expect(metrics.reorderSuggestionQty).toBe(156);
  });

  it("returns zero reorder when inventory is sufficient", () => {
    const metrics = computeForecastMetrics({
      sold7d: 7,
      sold30d: 30,
      inventoryQuantity: 300,
      safetyBufferDays: 5,
    });

    expect(metrics.reorderSuggestionQty).toBe(0);
  });
});

describe("classifyVariant", () => {
  it("classifies fast moving when short-term velocity spikes", () => {
    expect(classifyVariant(6, 2)).toBe(ProductClassification.FAST_MOVING);
  });

  it("classifies slow moving when velocity drops", () => {
    expect(classifyVariant(0.2, 1.2)).toBe(ProductClassification.SLOW_MOVING);
  });

  it("classifies stable when velocity is balanced", () => {
    expect(classifyVariant(2.2, 2.0)).toBe(ProductClassification.STABLE);
  });
});

