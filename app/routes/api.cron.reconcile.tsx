import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { recomputeMerchantForecasts } from "../services/inventory/forecast.server";
import { monitorVariantQuantity } from "../services/inventory/monitor.server";
import { retryFailedNotificationDeliveries } from "../services/notifications/dispatcher.server";
import { withRetry } from "../services/retry.server";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let processed = 0;
  let failed = 0;
  let cursorId: number | undefined;
  const batchSize = Math.min(
    500,
    Math.max(25, Number(process.env.CRON_BATCH_SIZE ?? "200")),
  );
  const merchantIds = new Set<number>();

  let hasMoreRows = true;
  while (hasMoreRows) {
    const inventoryRows = await prisma.variantInventory.findMany({
      where: cursorId ? { id: { gt: cursorId } } : undefined,
      include: {
        location: true,
        variant: {
          include: {
            product: true,
            merchant: {
              include: {
                settings: true,
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: batchSize,
    });

    if (!inventoryRows.length) {
      hasMoreRows = false;
      continue;
    }

    for (const row of inventoryRows) {
      const settings = row.variant.merchant.settings;
      if (!settings) continue;

      try {
        await withRetry(
          () =>
            monitorVariantQuantity({
              merchantId: row.variant.merchantId,
              settings,
              product: row.variant.product,
              variant: row.variant,
              location: row.location,
              currentQuantity: row.available,
            }),
          3,
          200,
        );
        processed += 1;
        merchantIds.add(row.variant.merchantId);
      } catch {
        failed += 1;
      }
    }

    cursorId = inventoryRows[inventoryRows.length - 1]?.id;
  }

  let forecastsUpdated = 0;
  for (const merchantId of merchantIds) {
    try {
      const result = await withRetry(
        () => recomputeMerchantForecasts(merchantId),
        3,
        250,
      );
      forecastsUpdated += result.variantsUpdated;
    } catch {
      failed += 1;
    }
  }

  const notificationRetry = await retryFailedNotificationDeliveries(100);

  return Response.json({
    ok: true,
    processed,
    failed,
    forecastsUpdated,
    notificationRetry,
  });
};

