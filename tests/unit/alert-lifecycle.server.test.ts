import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertStatus, NotificationEvent } from "@prisma/client";

const findManyMock = vi.fn();
const updateManyMock = vi.fn();
const updateMock = vi.fn();
const createMock = vi.fn();
const recordMetricEventMock = vi.fn();

vi.mock("../../app/db.server", () => ({
  default: {
    inventoryAlert: {
      findMany: findManyMock,
      updateMany: updateManyMock,
      update: updateMock,
      create: createMock,
    },
  },
}));

vi.mock("../../app/services/metrics.server", () => ({
  recordMetricEvent: recordMetricEventMock,
}));

describe("evaluateAlertLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an active alert when no active alert exists", async () => {
    findManyMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: 123 });

    const { evaluateAlertLifecycle } = await import(
      "../../app/services/inventory/alert-lifecycle.server"
    );

    const result = await evaluateAlertLifecycle({
      merchantId: 1,
      productId: 2,
      variantId: 3,
      currentQuantity: 2,
      thresholdValue: 5,
      alertLevel: "LOW",
      triggerEvent: NotificationEvent.LOW_STOCK,
    });

    expect(result.action).toBe("created_active");
    expect(result.alertId).toBe(123);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(recordMetricEventMock).toHaveBeenCalledTimes(1);
  });

  it("resolves active alerts when inventory is healthy", async () => {
    findManyMock.mockResolvedValue([
      {
        id: 99,
        alertLevel: "LOW",
        createdAt: new Date(Date.now() - 3600 * 1000),
        alertStatus: AlertStatus.ACTIVE,
      },
    ]);

    const { evaluateAlertLifecycle } = await import(
      "../../app/services/inventory/alert-lifecycle.server"
    );

    const result = await evaluateAlertLifecycle({
      merchantId: 1,
      productId: 2,
      variantId: 3,
      currentQuantity: 20,
      thresholdValue: 5,
      alertLevel: null,
      triggerEvent: null,
    });

    expect(result.action).toBe("resolved");
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(recordMetricEventMock).toHaveBeenCalledTimes(1);
  });

  it("updates same-level active alert instead of creating duplicate", async () => {
    findManyMock.mockResolvedValue([
      {
        id: 88,
        alertLevel: "CRITICAL",
        createdAt: new Date(),
        alertStatus: AlertStatus.ACTIVE,
      },
    ]);

    const { evaluateAlertLifecycle } = await import(
      "../../app/services/inventory/alert-lifecycle.server"
    );

    const result = await evaluateAlertLifecycle({
      merchantId: 1,
      productId: 2,
      variantId: 3,
      currentQuantity: 1,
      thresholdValue: 5,
      alertLevel: "CRITICAL",
      triggerEvent: NotificationEvent.CRITICAL_STOCK,
    });

    expect(result.action).toBe("updated_active");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });
});

