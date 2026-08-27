import prisma from "../../db.server";
import { buildReorderList } from "../inventory/reorder-list.server";
import { generateInventoryInsights } from "../ai/insights.server";
import { logger } from "../logger.server";

export async function generateWeeklyReport(merchantId: number) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  // Check if report already exists for this week
  const existingReport = await prisma.weeklyReport.findUnique({
    where: {
      merchantId_weekStart: {
        merchantId,
        weekStart,
      },
    },
  });

  if (existingReport) {
    return existingReport;
  }

  // Generate report data
  const { rows, summary } = await buildReorderList({ merchantId });
  const insights = await generateInventoryInsights(merchantId);

  // Get active alerts
  const activeAlerts = await prisma.inventoryAlert.count({
    where: { merchantId, alertStatus: "ACTIVE" },
  });

  const criticalAlerts = await prisma.inventoryAlert.count({
    where: { merchantId, alertStatus: "ACTIVE", alertLevel: "CRITICAL" },
  });

  // Build summary
  const summaryText = buildSummaryText(summary, activeAlerts, criticalAlerts);

  // Top products (by urgency)
  const topProducts = rows
    .filter((r) => r.urgencyScore > 50)
    .slice(0, 5)
    .map((r) => `• ${r.productTitle} (urgency: ${r.urgencyScore}, stock: ${r.inventoryQuantity})`)
    .join("\n");

  // Concerns
  const concerns = insights
    .filter((i) => i.type === "STOCKOUT_RISK" || i.type === "DEAD_STOCK")
    .slice(0, 5)
    .map((i) => `• ${i.title}: ${i.message}`)
    .join("\n");

  // Action items
  const actionItems = buildActionItems(summary, rows.length, activeAlerts);

  // Metrics
  const metrics = JSON.stringify({
    stockHealthScore: summary.stockHealthScore,
    totalSKUs: rows.length,
    needsReorder: summary.needsReorder,
    deadStock: summary.deadStockCount,
    activeAlerts,
    criticalAlerts,
  });

  // Create report
  const report = await prisma.weeklyReport.create({
    data: {
      merchantId,
      weekStart,
      weekEnd,
      summary: summaryText,
      topProducts: topProducts || "No urgent products this week.",
      concerns: concerns || "No major concerns this week.",
      actionItems,
      metrics,
    },
  });

  return report;
}

function buildSummaryText(
  summary: { stockHealthScore: number; needsReorder: number; deadStockCount: number },
  activeAlerts: number,
  criticalAlerts: number,
): string {
  const healthStatus =
    summary.stockHealthScore >= 80
      ? "excellent"
      : summary.stockHealthScore >= 60
        ? "good"
        : summary.stockHealthScore >= 40
          ? "needs attention"
          : "critical";

  return `Weekly Inventory Report

Stock Health: ${summary.stockHealthScore}% (${healthStatus})

Key Metrics:
• ${summary.needsReorder} SKUs need reordering
• ${summary.deadStockCount} dead stock items (no sales in 30+ days)
• ${activeAlerts} active alerts (${criticalAlerts} critical)

${summary.stockHealthScore < 60 ? "⚠️ Your inventory health is below optimal. Review the concerns and action items below." : "✅ Your inventory is in good shape. Keep monitoring the items below."}`;
}

function buildActionItems(
  summary: { needsReorder: number; deadStockCount: number },
  totalSKUs: number,
  activeAlerts: number,
): string {
  const items: string[] = [];

  if (summary.needsReorder > 0) {
    items.push(`1. Review and create POs for ${summary.needsReorder} SKUs needing reorder`);
  }

  if (summary.deadStockCount > 0) {
    items.push(
      `${items.length + 1}. Consider markdowns or promotions for ${summary.deadStockCount} dead stock items`,
    );
  }

  if (activeAlerts > 0) {
    items.push(`${items.length + 1}. Address ${activeAlerts} active inventory alerts`);
  }

  if (items.length === 0) {
    items.push("✅ No urgent action items this week. Keep up the good work!");
  }

  return items.join("\n");
}

export async function sendWeeklyReportEmail(merchantId: number, reportId: number) {
  const report = await prisma.weeklyReport.findUnique({
    where: { id: reportId },
    include: { merchant: true },
  });

  if (!report) {
    throw new Error("Report not found");
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const toEmail = report.merchant.contactEmail;

  if (!resendKey || !fromEmail || !toEmail) {
    logger.warn("Email not configured for weekly report", {
      merchantId,
      reportId,
      hasResendKey: Boolean(resendKey),
      hasFromEmail: Boolean(fromEmail),
      hasToEmail: Boolean(toEmail),
    });
    return null;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: toEmail,
      subject: `Weekly Inventory Report - ${new Date(report.weekStart).toLocaleDateString()}`,
      text: `${report.summary}\n\n--- Top Products ---\n${report.topProducts}\n\n--- Concerns ---\n${report.concerns}\n\n--- Action Items ---\n${report.actionItems}`,
    }),
  });

  if (response.ok) {
    await prisma.weeklyReport.update({
      where: { id: reportId },
      data: { sentAt: new Date() },
    });
  }

  return response.ok;
}
