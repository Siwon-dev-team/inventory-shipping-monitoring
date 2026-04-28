import { MetricEventType } from "@prisma/client";
import prisma from "../db.server";

type RecordMetricEventInput = {
  merchantId: number;
  eventType: MetricEventType;
  metricKey?: string;
  value?: number;
  metadata?: Record<string, unknown>;
};

export async function recordMetricEvent(input: RecordMetricEventInput) {
  await prisma.metricEvent.create({
    data: {
      merchantId: input.merchantId,
      eventType: input.eventType,
      metricKey: input.metricKey ?? null,
      value: input.value ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function getMerchantKpiSummary(merchantId: number) {
  const installedCount = await prisma.metricEvent.count({
    where: {
      merchantId,
      eventType: MetricEventType.APP_INSTALLED,
    },
  });

  const monitoringEnabledCount = await prisma.metricEvent.count({
    where: {
      merchantId,
      eventType: MetricEventType.MONITORING_ENABLED,
    },
  });

  const alertCreatedCount = await prisma.metricEvent.count({
    where: {
      merchantId,
      eventType: MetricEventType.ALERT_CREATED,
    },
  });

  const alertResolvedEvents = await prisma.metricEvent.findMany({
    where: {
      merchantId,
      eventType: MetricEventType.ALERT_RESOLVED,
      value: { not: null },
    },
    select: { value: true },
  });

  const resolutionHours =
    alertResolvedEvents.length > 0
      ? alertResolvedEvents.reduce((sum, entry) => sum + (entry.value ?? 0), 0) /
        alertResolvedEvents.length
      : null;

  return {
    installedCount,
    monitoringEnabledCount,
    alertCreatedCount,
    averageAlertToRestockHours: resolutionHours,
  };
}

