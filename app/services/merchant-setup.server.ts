import type { Merchant, Settings } from "@prisma/client";
import {
  MetricEventType,
  NotificationChannel,
  NotificationEvent,
} from "@prisma/client";
import prisma from "../db.server";
import { recordMetricEvent } from "./metrics.server";

type MerchantWithSettings = Merchant & { settings: Settings | null };

const DEFAULT_NOTIFICATION_FLOW: Array<{
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}> = [
  {
    event: NotificationEvent.LOW_STOCK,
    channel: NotificationChannel.EMAIL,
    enabled: true,
  },
  {
    event: NotificationEvent.CRITICAL_STOCK,
    channel: NotificationChannel.EMAIL,
    enabled: true,
  },
  {
    event: NotificationEvent.OUT_OF_STOCK,
    channel: NotificationChannel.EMAIL,
    enabled: true,
  },
  {
    event: NotificationEvent.RESTOCKED,
    channel: NotificationChannel.EMAIL,
    enabled: false,
  },
];

export async function ensureMerchantSetup(
  shopDomain: string,
  contactEmail?: string | null,
): Promise<MerchantWithSettings> {
  const existingMerchant = await prisma.merchant.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  const merchant = await prisma.merchant.upsert({
    where: { shopDomain },
    update: {
      ...(contactEmail ? { contactEmail } : {}),
    },
    create: {
      shopDomain,
      contactEmail: contactEmail ?? null,
      settings: {
        create: {
          monitoringEnabled: true,
          globalLowThreshold: 5,
          globalCriticalThreshold: 2,
          safetyBufferDays: 5,
          notifyOnRestocked: false,
          schedulerIntervalMinutes: 15,
        },
      },
    },
    include: {
      settings: true,
    },
  });

  if (!merchant.settings) {
    await prisma.settings.create({
      data: {
        merchantId: merchant.id,
        monitoringEnabled: true,
        globalLowThreshold: 5,
        globalCriticalThreshold: 2,
        safetyBufferDays: 5,
        notifyOnRestocked: false,
        schedulerIntervalMinutes: 15,
      },
    });
  }

  for (const entry of DEFAULT_NOTIFICATION_FLOW) {
    await prisma.notificationFlow.upsert({
      where: {
        merchantId_event_channel: {
          merchantId: merchant.id,
          event: entry.event,
          channel: entry.channel,
        },
      },
      update: {
        enabled: entry.enabled,
      },
      create: {
        merchantId: merchant.id,
        event: entry.event,
        channel: entry.channel,
        enabled: entry.enabled,
      },
    });
  }

  if (!existingMerchant) {
    await recordMetricEvent({
      merchantId: merchant.id,
      eventType: MetricEventType.APP_INSTALLED,
    });
  }

  return prisma.merchant.findUniqueOrThrow({
    where: { id: merchant.id },
    include: { settings: true },
  });
}

