import { describe, expect, it } from "vitest";
import { AlertLevel, NotificationEvent } from "@prisma/client";
import { resolveThresholdState } from "../../app/services/inventory/threshold.server";

describe("resolveThresholdState", () => {
  it("uses threshold priority variant > product > location > global", () => {
    const result = resolveThresholdState({
      quantity: 6,
      globalLowThreshold: 20,
      locationLowThreshold: 15,
      productLowThreshold: 10,
      variantLowThreshold: 8,
      globalCriticalThreshold: 5,
      locationCriticalThreshold: 4,
      productCriticalThreshold: 3,
      variantCriticalThreshold: 2,
    });

    expect(result.lowThreshold).toBe(8);
    expect(result.criticalThreshold).toBe(2);
    expect(result.alertLevel).toBe(AlertLevel.LOW);
    expect(result.triggerEvent).toBe(NotificationEvent.LOW_STOCK);
  });

  it("returns out of stock when quantity is zero", () => {
    const result = resolveThresholdState({
      quantity: 0,
      globalLowThreshold: 5,
    });

    expect(result.alertLevel).toBe(AlertLevel.OUT_OF_STOCK);
    expect(result.triggerEvent).toBe(NotificationEvent.OUT_OF_STOCK);
  });

  it("returns no alert when quantity is above low threshold", () => {
    const result = resolveThresholdState({
      quantity: 12,
      globalLowThreshold: 5,
      globalCriticalThreshold: 2,
    });

    expect(result.alertLevel).toBeNull();
    expect(result.triggerEvent).toBeNull();
  });
});

