import {
  AlertStatus,
  MetricEventType,
  NotificationEvent,
  type AlertLevel,
} from "@prisma/client";
import prisma from "../../db.server";
import { recordMetricEvent } from "../metrics.server";

type EvaluateAlertInput = {
  merchantId: number;
  productId: number;
  variantId: number;
  locationId?: number | null;
  currentQuantity: number;
  thresholdValue: number;
  alertLevel: AlertLevel | null;
  triggerEvent: NotificationEvent | null;
};

export async function evaluateAlertLifecycle(input: EvaluateAlertInput) {
  const activeAlerts = await prisma.inventoryAlert.findMany({
    where: {
      merchantId: input.merchantId,
      variantId: input.variantId,
      locationId: input.locationId ?? null,
      alertStatus: AlertStatus.ACTIVE,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!input.alertLevel || !input.triggerEvent) {
    if (!activeAlerts.length) {
      return { changed: false, action: "none" as const };
    }

    const latestActiveAlert = activeAlerts[0];
    const resolutionHours = latestActiveAlert
      ? (Date.now() - latestActiveAlert.createdAt.getTime()) / (1000 * 60 * 60)
      : null;

    await prisma.inventoryAlert.updateMany({
      where: {
        id: {
          in: activeAlerts.map((alert) => alert.id),
        },
      },
      data: {
        alertStatus: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        currentQuantity: input.currentQuantity,
      },
    });

    await recordMetricEvent({
      merchantId: input.merchantId,
      eventType: MetricEventType.ALERT_RESOLVED,
      metricKey: latestActiveAlert?.alertLevel,
      value: resolutionHours ?? undefined,
      metadata: {
        variantId: input.variantId,
        productId: input.productId,
        locationId: input.locationId ?? null,
        currentQuantity: input.currentQuantity,
      },
    });

    return {
      changed: true,
      action: "resolved" as const,
      event: NotificationEvent.RESTOCKED,
      alertId: activeAlerts[0]?.id,
    };
  }

  const sameLevelAlert = activeAlerts.find((alert) => alert.alertLevel === input.alertLevel);
  if (sameLevelAlert) {
    await prisma.inventoryAlert.update({
      where: { id: sameLevelAlert.id },
      data: {
        currentQuantity: input.currentQuantity,
        thresholdValue: input.thresholdValue,
        triggerEvent: input.triggerEvent,
      },
    });

    return {
      changed: true,
      action: "updated_active" as const,
      event: null,
      alertId: sameLevelAlert.id,
    };
  }

  if (activeAlerts.length) {
    await prisma.inventoryAlert.updateMany({
      where: {
        id: {
          in: activeAlerts.map((alert) => alert.id),
        },
      },
      data: {
        alertStatus: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        currentQuantity: input.currentQuantity,
      },
    });
  }

  const createdAlert = await prisma.inventoryAlert.create({
    data: {
      merchantId: input.merchantId,
      productId: input.productId,
      variantId: input.variantId,
      locationId: input.locationId ?? null,
      thresholdValue: input.thresholdValue,
      currentQuantity: input.currentQuantity,
      alertLevel: input.alertLevel,
      triggerEvent: input.triggerEvent,
      alertStatus: AlertStatus.ACTIVE,
    },
  });

  await recordMetricEvent({
    merchantId: input.merchantId,
    eventType: MetricEventType.ALERT_CREATED,
    metricKey: input.alertLevel,
    value: input.currentQuantity,
    metadata: {
      variantId: input.variantId,
      productId: input.productId,
      locationId: input.locationId ?? null,
      thresholdValue: input.thresholdValue,
    },
  });

  return {
    changed: true,
    action: "created_active" as const,
    event: input.triggerEvent,
    alertId: createdAlert.id,
  };
}

