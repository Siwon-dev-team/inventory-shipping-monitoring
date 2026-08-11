import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock, createMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    subscription: {
      findUnique: findUniqueMock,
      create: createMock,
      update: updateMock,
      upsert: vi.fn(),
    },
  },
}));

import {
  getOrCreateSubscription,
  checkQueryLimit,
  hasFeature,
  getPlanLimits,
} from "../../app/services/billing/subscription.server";

describe("subscription.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getOrCreateSubscription", () => {
    it("returns existing subscription if found", async () => {
      const existingSubscription = {
        id: 1,
        merchantId: 1,
        plan: "FREE",
        status: "ACTIVE",
        dailyQueryCount: 5,
        dailyQueryLimit: 20,
        queryResetAt: new Date(),
      };

      findUniqueMock.mockResolvedValue(existingSubscription);

      const result = await getOrCreateSubscription(1);

      expect(result).toEqual(existingSubscription);
      expect(createMock).not.toHaveBeenCalled();
    });

    it("creates new subscription if not found", async () => {
      findUniqueMock.mockResolvedValue(null);

      const newSubscription = {
        id: 1,
        merchantId: 1,
        plan: "FREE",
        status: "ACTIVE",
        dailyQueryCount: 0,
        dailyQueryLimit: 20,
        queryResetAt: new Date(),
      };

      createMock.mockResolvedValue(newSubscription);

      const result = await getOrCreateSubscription(1);

      expect(result).toEqual(newSubscription);
      expect(createMock).toHaveBeenCalled();
    });
  });

  describe("checkQueryLimit", () => {
    it("allows queries when under limit", async () => {
      const subscription = {
        id: 1,
        merchantId: 1,
        plan: "FREE" as const,
        status: "ACTIVE",
        dailyQueryCount: 5,
        dailyQueryLimit: 20,
        queryResetAt: new Date(Date.now() + 86400000), // Tomorrow
      };

      findUniqueMock.mockResolvedValue(subscription);

      const result = await checkQueryLimit(1);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(15);
      expect(result.plan).toBe("FREE");
    });

    it("blocks queries when at limit", async () => {
      const subscription = {
        id: 1,
        merchantId: 1,
        plan: "FREE" as const,
        status: "ACTIVE",
        dailyQueryCount: 20,
        dailyQueryLimit: 20,
        queryResetAt: new Date(Date.now() + 86400000),
      };

      findUniqueMock.mockResolvedValue(subscription);

      const result = await checkQueryLimit(1);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe("hasFeature", () => {
    it("returns true for features in FREE plan", () => {
      expect(hasFeature("FREE", "basic_qa")).toBe(true);
      expect(hasFeature("FREE", "basic_insights")).toBe(true);
    });

    it("returns false for PRO features in FREE plan", () => {
      expect(hasFeature("FREE", "advanced_qa")).toBe(false);
      expect(hasFeature("FREE", "function_calling")).toBe(false);
      expect(hasFeature("FREE", "auto_replenishment")).toBe(false);
    });

    it("returns true for all features in PRO plan", () => {
      expect(hasFeature("PRO", "basic_qa")).toBe(true);
      expect(hasFeature("PRO", "advanced_qa")).toBe(true);
      expect(hasFeature("PRO", "function_calling")).toBe(true);
      expect(hasFeature("PRO", "auto_replenishment")).toBe(true);
      expect(hasFeature("PRO", "weekly_reports")).toBe(true);
    });
  });

  describe("getPlanLimits", () => {
    it("returns correct limits for FREE plan", () => {
      const limits = getPlanLimits("FREE");
      expect(limits.dailyQueryLimit).toBe(20);
      expect(limits.historicalDays).toBe(30);
    });

    it("returns correct limits for PRO plan", () => {
      const limits = getPlanLimits("PRO");
      expect(limits.dailyQueryLimit).toBe(1000);
      expect(limits.historicalDays).toBe(365);
    });
  });
});
