import {
  NotificationChannel,
  NotificationDeliveryStatus,
  type NotificationEvent,
} from "@prisma/client";
import prisma from "../../db.server";
import { sendEmail } from "./email.server";
import { withRetry } from "../retry.server";

type DispatchPayload = {
  merchantId: number;
  event: NotificationEvent;
  alertId?: number;
  productTitle: string;
  variantSku: string | null;
  currentQuantity: number;
  thresholdValue: number;
  levelLabel: string;
};

function getNextRetryAt(retryCount: number) {
  const delayMinutes = Math.min(60, 5 * 2 ** retryCount);
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

async function markDeliveryFailed(
  deliveryId: number,
  previousRetryCount: number,
  maxRetries: number,
  errorMessage: string,
) {
  const retryCount = previousRetryCount + 1;
  const nextRetryAt = retryCount < maxRetries ? getNextRetryAt(previousRetryCount) : null;

  await prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status: NotificationDeliveryStatus.FAILED,
      errorMessage,
      retryCount,
      nextRetryAt,
      attemptedAt: new Date(),
    },
  });
}

export async function dispatchInventoryNotification(payload: DispatchPayload) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: payload.merchantId },
  });
  if (!merchant) return;

  const flows = await prisma.notificationFlow.findMany({
    where: {
      merchantId: payload.merchantId,
      event: payload.event,
      enabled: true,
    },
  });

  if (!flows.length) return;

  for (const flow of flows) {
    const delivery = await prisma.notificationDelivery.create({
      data: {
        merchantId: payload.merchantId,
        alertId: payload.alertId,
        event: payload.event,
        channel: flow.channel,
        status: NotificationDeliveryStatus.PENDING,
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: new Date(),
      },
    });

    try {
      if (flow.channel === NotificationChannel.EMAIL) {
        const recipient = merchant.contactEmail || process.env.ALERT_EMAIL_TO;
        if (!recipient) {
          throw new Error("Missing recipient email");
        }

        await withRetry(
          () =>
            sendEmail({
              to: recipient,
              subject: `[${payload.levelLabel}] ${payload.productTitle} inventory alert`,
              text: [
                `Shop: ${merchant.shopDomain}`,
                `Event: ${payload.event}`,
                `Product: ${payload.productTitle}`,
                `SKU: ${payload.variantSku || "N/A"}`,
                `Current quantity: ${payload.currentQuantity}`,
                `Threshold: ${payload.thresholdValue}`,
              ].join("\n"),
            }),
          2,
          200,
        );

        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: NotificationDeliveryStatus.SENT,
            recipient,
            deliveredAt: new Date(),
            attemptedAt: new Date(),
            retryCount: 0,
            nextRetryAt: null,
          },
        });

        if (payload.alertId) {
          await prisma.inventoryAlert.update({
            where: { id: payload.alertId },
            data: {
              lastAlertSentAt: new Date(),
            },
          });
        }
      } else {
        await markDeliveryFailed(
          delivery.id,
          delivery.retryCount,
          delivery.maxRetries,
          `${flow.channel} channel is not implemented`,
        );
      }
    } catch (error) {
      await markDeliveryFailed(
        delivery.id,
        delivery.retryCount,
        delivery.maxRetries,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }
}

export async function retryFailedNotificationDeliveries(limit = 50) {
  const now = new Date();
  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      status: NotificationDeliveryStatus.FAILED,
      retryCount: { lt: 10 },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    include: {
      merchant: true,
      alert: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
    orderBy: {
      attemptedAt: "asc",
    },
    take: limit,
  });

  let retried = 0;
  let succeeded = 0;

  for (const delivery of deliveries) {
    if (delivery.retryCount >= delivery.maxRetries) continue;
    if (delivery.channel !== NotificationChannel.EMAIL) continue;

    const merchant = delivery.merchant;
    const recipient =
      delivery.recipient || merchant.contactEmail || process.env.ALERT_EMAIL_TO;

    if (!recipient) {
      await markDeliveryFailed(
        delivery.id,
        delivery.retryCount,
        delivery.maxRetries,
        "Missing recipient email",
      );
      retried += 1;
      continue;
    }

    try {
      const productTitle = delivery.alert?.product.title ?? "Inventory alert";
      const variantSku = delivery.alert?.variant.sku ?? "N/A";
      const currentQuantity = delivery.alert?.currentQuantity ?? 0;
      const thresholdValue = delivery.alert?.thresholdValue ?? 0;

      await withRetry(
        () =>
          sendEmail({
            to: recipient,
            subject: `[RETRY] ${productTitle} inventory alert`,
            text: [
              `Shop: ${merchant.shopDomain}`,
              `Event: ${delivery.event}`,
              `Product: ${productTitle}`,
              `SKU: ${variantSku}`,
              `Current quantity: ${currentQuantity}`,
              `Threshold: ${thresholdValue}`,
            ].join("\n"),
          }),
        2,
        200,
      );

      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          deliveredAt: new Date(),
          attemptedAt: new Date(),
          recipient,
          nextRetryAt: null,
        },
      });
      retried += 1;
      succeeded += 1;
    } catch (error) {
      await markDeliveryFailed(
        delivery.id,
        delivery.retryCount,
        delivery.maxRetries,
        error instanceof Error ? error.message : "Unknown error",
      );
      retried += 1;
    }
  }

  return { retried, succeeded };
}

