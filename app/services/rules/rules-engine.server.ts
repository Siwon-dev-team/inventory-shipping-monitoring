import prisma from "../../db.server";
import { buildReorderList } from "../inventory/reorder-list.server";
import { createPurchaseOrdersFromReorderRows } from "../inventory/purchase-orders.server";
import { sendSlackMessage } from "../notifications/slack.server";
import { sendEmail } from "../notifications/email.server";
import { logger } from "../logger.server";

export async function runReplenishmentRules(merchantId: number): Promise<{
  rulesRun: number;
  actionsTriggered: number;
  results: Array<{ ruleId: number; ruleName: string; triggered: boolean; action: string | null }>;
}> {
  const rules = await prisma.replenishmentRule.findMany({
    where: { merchantId, enabled: true },
    include: { merchant: true },
  });

  const { rows } = await buildReorderList({ merchantId });
  const results: Array<{ ruleId: number; ruleName: string; triggered: boolean; action: string | null }> = [];
  let actionsTriggered = 0;

  for (const rule of rules) {
    const triggered = await evaluateRule(rule, rows);

    if (triggered) {
      await executeRuleAction(rule, rows, merchantId);
      actionsTriggered++;

      // Update last run time
      await prisma.replenishmentRule.update({
        where: { id: rule.id },
        data: { lastRunAt: new Date() },
      });
    }

    results.push({
      ruleId: rule.id,
      ruleName: rule.name,
      triggered,
      action: triggered ? rule.action : null,
    });
  }

  return {
    rulesRun: rules.length,
    actionsTriggered,
    results,
  };
}

async function evaluateRule(
  rule: {
    trigger: string;
    triggerValue: number;
  },
  rows: Array<{
    daysOfCover: number | null;
    stockoutDate: string | null;
    inventoryQuantity: number;
  }>,
): Promise<boolean> {
  switch (rule.trigger) {
    case "DAYS_OF_COVER": {
      // Check if any SKU has days of cover below threshold
      return rows.some(
        (row) => row.daysOfCover !== null && row.daysOfCover < rule.triggerValue,
      );
    }

    case "STOCKOUT_DATE": {
      // Check if any SKU will stock out within X days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() + rule.triggerValue);

      return rows.some((row) => {
        if (!row.stockoutDate) return false;
        return new Date(row.stockoutDate) <= cutoffDate;
      });
    }

    case "QUANTITY_BELOW": {
      // Check if any SKU has quantity below threshold
      return rows.some((row) => row.inventoryQuantity < rule.triggerValue);
    }

    default:
      return false;
  }
}

async function executeRuleAction(
  rule: {
    id: number;
    name: string;
    action: string;
    triggerValue: number;
    trigger: string;
    merchant: { shopDomain: string; contactEmail: string | null };
  },
  rows: Array<{
    productTitle: string;
    sku: string | null;
    inventoryQuantity: number;
    daysOfCover: number | null;
    stockoutDate: string | null;
    reorderSuggestionQty: number;
    urgencyScore: number;
  }>,
  merchantId: number,
): Promise<void> {
  // Filter rows that triggered this rule
  const triggeredRows = rows.filter((row) => {
    switch (rule.trigger) {
      case "DAYS_OF_COVER":
        return row.daysOfCover !== null && row.daysOfCover < rule.triggerValue;
      case "STOCKOUT_DATE": {
        if (!row.stockoutDate) return false;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + rule.triggerValue);
        return new Date(row.stockoutDate) <= cutoff;
      }
      case "QUANTITY_BELOW":
        return row.inventoryQuantity < rule.triggerValue;
      default:
        return false;
    }
  });

  switch (rule.action) {
    case "CREATE_DRAFT_PO": {
      await createPurchaseOrdersFromReorderRows(merchantId, triggeredRows as Parameters<typeof createPurchaseOrdersFromReorderRows>[1]);
      break;
    }

    case "NOTIFY_SLACK": {
      const settings = await prisma.settings.findUnique({
        where: { merchantId },
      });

      if (settings?.slackWebhookUrl) {
        const message = buildNotificationMessage(rule.name, triggeredRows);
        await sendSlackMessage(settings.slackWebhookUrl, message);
      }
      break;
    }

    case "NOTIFY_EMAIL": {
      if (rule.merchant.contactEmail) {
        const message = buildNotificationMessage(rule.name, triggeredRows);
        try {
          await sendEmail({
            to: rule.merchant.contactEmail,
            subject: `[Auto-Replenishment] ${rule.name} triggered`,
            text: message,
          });
        } catch (error) {
          logger.error("Failed to send auto-replenishment email", error, {
            ruleName: rule.name,
            merchantId,
          });
        }
      }
      break;
    }
  }
}

function buildNotificationMessage(
  ruleName: string,
  rows: Array<{
    productTitle: string;
    sku: string | null;
    inventoryQuantity: number;
    reorderSuggestionQty: number;
  }>,
): string {
  const itemList = rows
    .slice(0, 10)
    .map(
      (row) =>
        `• ${row.productTitle}${row.sku ? ` (${row.sku})` : ""}: ${row.inventoryQuantity} in stock, reorder ${row.reorderSuggestionQty}`,
    )
    .join("\n");

  return `Auto-Replenishment Rule "${ruleName}" triggered for ${rows.length} item(s):\n\n${itemList}${rows.length > 10 ? `\n... and ${rows.length - 10} more` : ""}`;
}
