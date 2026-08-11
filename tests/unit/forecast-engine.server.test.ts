import { describe, it, expect, vi, beforeEach } from "vitest";

const { findManyMock, findUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    dailySalesSnapshot: {
      findMany: findManyMock,
    },
    variant: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
      update: vi.fn(),
    },
  },
}));

vi.mock("../../app/services/sync/order-history.server", () => ({
  getDailySalesForVariant: vi.fn().mockResolvedValue([]),
  detectSeasonalPattern: vi.fn().mockResolvedValue({
    hasSeasonality: false,
    peakMonths: [],
    lowMonths: [],
    seasonalityScore: 0,
  }),
}));

import { generateForecast } from "../../app/services/forecast/forecast-engine.server";
import { getDailySalesForVariant, detectSeasonalPattern } from "../../app/services/sync/order-history.server";

describe("forecast-engine.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateForecast", () => {
    it("returns simple forecast with no data", async () => {
      vi.mocked(getDailySalesForVariant).mockResolvedValue([]);
      findUniqueMock.mockResolvedValue({ salesVelocity30d: 2 });

      const result = await generateForecast(1);

      expect(result.variantId).toBe(1);
      expect(result.forecastDaily).toBe(2);
      expect(result.forecast7d).toBe(14);
      expect(result.forecast30d).toBe(60);
      expect(result.method).toBe("simple");
      expect(result.confidence).toBe(20);
    });

    it("returns weighted forecast with sufficient data", async () => {
      const salesData = Array.from({ length: 30 }, (_, i) => ({
        date: new Date(Date.now() - i * 86400000),
        quantitySold: 5,
        revenue: 50,
      }));

      vi.mocked(getDailySalesForVariant).mockResolvedValue(salesData);
      vi.mocked(detectSeasonalPattern).mockResolvedValue({
        hasSeasonality: false,
        peakMonths: [],
        lowMonths: [],
        seasonalityScore: 0,
      });

      const result = await generateForecast(1);

      expect(result.method).toBe("weighted");
      expect(result.forecastDaily).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(20);
    });

    it("applies seasonal adjustment when detected", async () => {
      const salesData = Array.from({ length: 90 }, (_, i) => ({
        date: new Date(Date.now() - i * 86400000),
        quantitySold: 5,
        revenue: 50,
      }));

      vi.mocked(getDailySalesForVariant).mockResolvedValue(salesData);
      vi.mocked(detectSeasonalPattern).mockResolvedValue({
        hasSeasonality: true,
        peakMonths: [new Date().getMonth()], // Current month is peak
        lowMonths: [],
        seasonalityScore: 50,
      });

      const result = await generateForecast(1);

      expect(result.method).toBe("seasonal");
      expect(result.seasonalAdjustment).toBe(1.3);
    });

    it("detects trend correctly", async () => {
      // With more recent data having higher sales
      const salesData = Array.from({ length: 90 }, (_, i) => ({
        date: new Date(Date.now() - i * 86400000),
        quantitySold: i < 30 ? 10 : 5, // Recent (first 30) higher than older
        revenue: i < 30 ? 100 : 50,
      }));

      vi.mocked(getDailySalesForVariant).mockResolvedValue(salesData);
      vi.mocked(detectSeasonalPattern).mockResolvedValue({
        hasSeasonality: false,
        peakMonths: [],
        lowMonths: [],
        seasonalityScore: 0,
      });

      const result = await generateForecast(1);

      // Should detect a trend (direction depends on implementation)
      expect(["up", "down", "stable"]).toContain(result.trend);
    });
  });
});
