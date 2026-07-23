import { DigestFrequency } from "@prisma/client";
import prisma from "../../db.server";
import { buildReorderList } from "../inventory/reorder-list.server";
import { sendEmail } from "./email.server";
import { sendSlackMessage } from "./slack.server";

function shouldSendDigest(
  frequency: DigestFrequency,
  lastDigestSentAt: Date | null | undefined,
  now = new Date(),
) {
  if (!lastDigestSentAt) return true;

  const elapsedMs = now.getTime() - lastDigestSentAt.getTime();
  if (frequency === DigestFrequency.WEEKLY) {
    return elapsedMs >= 7 * 24 * 60 * 60 * 1000;
  }

  return elapsedMs >= 24 * 60 * 60 * 1000;
}

export async function sendInventoryDigestForMerchant(merchantId: number) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    include: { settings: true },
  });

  if (!merchant?.settings?.digestEnabled) {
    return { sent: false as const, reason: "digest_disabled" };
  }

  if (
    !shouldSendDigest(
      merchant.settings.digestFrequency,
      merchant.settings.lastDigestSentAt,
    )
  ) {
    return { sent: false as const, reason: "not_due" };
  }

  const { rows, summary } = await buildReorderList({
    merchantId,
    needsReorderOnly: true,
  });

  const topRows = rows.slice(0, 20);
  const label =
    merchant.settings.digestFrequency === DigestFrequency.WEEKLY ? "Weekly" : "Daily";
  const lines = [
    `${label} inventory digest for ${merchant.shopDomain}`,
    `Stock health: ${summary.stockHealthScore}%`,
    `Active alerts: ${summary.activeAlerts}`,
    `SKUs needing reorder: ${summary.needsReorder}`,
    `Dead stock SKUs: ${summary.deadStockCount}`,
    "",
    ...topRows.map(
      (row) =>
        `- ${row.productTitle} (${row.sku || "no SKU"}) @ ${row.locationName || "default"}: qty ${row.inventoryQuantity}, reorder ${row.reorderSuggestionQty}, urgency ${row.urgencyScore}`,
    ),
  ];

  const message = lines.join("\n");
  let emailSent = false;
  let slackSent = false;

  const recipient = merchant.contactEmail || process.env.ALERT_EMAIL_TO;
  if (recipient) {
    await sendEmail({
      to: recipient,
      subject: `[${label} digest] Inventory summary for ${merchant.shopDomain}`,
      text: message,
    });
    emailSent = true;
  }

  if (merchant.settings.slackWebhookUrl) {
    await sendSlackMessage(merchant.settings.slackWebhookUrl, message);
    slackSent = true;
  }

  if (!emailSent && !slackSent) {
    return { sent: false as const, reason: "no_recipients" };
  }

  await prisma.settings.update({
    where: { merchantId },
    data: { lastDigestSentAt: new Date() },
  });

  return { sent: true as const, emailSent, slackSent, rowCount: topRows.length };
}

export async function sendDailyDigestsForAllMerchants() {
  const merchants = await prisma.merchant.findMany({
    where: {
      settings: {
        digestEnabled: true,
      },
    },
    select: { id: true },
  });

  let sent = 0;
  let skipped = 0;

  for (const merchant of merchants) {
    try {
      const result = await sendInventoryDigestForMerchant(merchant.id);
      if (result.sent) sent += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }

  return { merchants: merchants.length, sent, skipped };
}

// Backward-compatible export
export const sendDailyDigestForMerchant = sendInventoryDigestForMerchant;
