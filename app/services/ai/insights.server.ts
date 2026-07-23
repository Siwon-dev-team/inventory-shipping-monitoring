import { AiInsightType } from "@prisma/client";
import prisma from "../../db.server";
import { buildReorderList } from "../inventory/reorder-list.server";
import { detectVelocityAnomalies } from "./anomaly-detection.server";

export type GeneratedInsight = {
  type: AiInsightType;
  title: string;
  message: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

function classifyAbc(velocity30d: number, maxVelocity: number): "A" | "B" | "C" {
  if (maxVelocity <= 0) return "C";
  const ratio = velocity30d / maxVelocity;
  if (ratio >= 0.7) return "A";
  if (ratio >= 0.3) return "B";
  return "C";
}

export async function generateInventoryInsights(
  merchantId: number,
): Promise<GeneratedInsight[]> {
  const { rows, summary } = await buildReorderList({
    merchantId,
    needsReorderOnly: false,
  });

  const insights: GeneratedInsight[] = [];
  const maxVelocity = Math.max(...rows.map((row) => row.velocity30d), 0);

  insights.push({
    type: AiInsightType.SUMMARY,
    title: "Inventory health summary",
    message: `Stock health is ${summary.stockHealthScore}%. ${summary.needsReorder} SKUs need reorder and ${summary.deadStockCount} look like dead stock.`,
    score: summary.stockHealthScore,
  });

  const urgent = rows
    .filter((row) => row.urgencyScore >= 70)
    .slice(0, 5);
  for (const row of urgent) {
    insights.push({
      type: AiInsightType.REORDER_PRIORITY,
      title: `Priority reorder: ${row.productTitle}`,
      message: `Urgency ${row.urgencyScore}. ${row.daysOfCover != null ? `${row.daysOfCover.toFixed(1)} days of cover left.` : "Low velocity."} Suggested reorder ${row.reorderSuggestionQty}.`,
      score: row.urgencyScore,
      metadata: { variantId: row.variantId, sku: row.sku },
    });
  }

  for (const row of rows.filter((row) => row.isDeadStock).slice(0, 5)) {
    insights.push({
      type: AiInsightType.DEAD_STOCK,
      title: `Dead stock: ${row.productTitle}`,
      message: `${row.inventoryQuantity} units on hand with no recent sales. Consider markdown or pausing reorders.`,
      metadata: { variantId: row.variantId },
    });
  }

  for (const row of rows.filter(
    (row) => row.daysOfCover !== null && row.daysOfCover <= 7 && row.reorderSuggestionQty > 0,
  ).slice(0, 5)) {
    insights.push({
      type: AiInsightType.STOCKOUT_RISK,
      title: `Stockout risk: ${row.productTitle}`,
      message: `Only ${row.daysOfCover?.toFixed(1)} days of cover at ${row.locationName || "default location"}.`,
      score: row.urgencyScore,
      metadata: { variantId: row.variantId },
    });
  }

  const variantRows = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (!variantRows.has(row.variantId)) {
      variantRows.set(row.variantId, row);
    }
  }

  const anomalies = detectVelocityAnomalies(
    Array.from(variantRows.values()).map((row) => ({
      variantId: row.variantId,
      productTitle: row.productTitle,
      sku: row.sku,
      velocity7d: row.velocity7d,
      velocity30d: row.velocity30d,
      classification: row.classification,
    })),
  );

  for (const anomaly of anomalies.slice(0, 5)) {
    insights.push({
      type:
        anomaly.type === "SPIKE" ? AiInsightType.VELOCITY_SPIKE : AiInsightType.VELOCITY_DROP,
      title:
        anomaly.type === "SPIKE"
          ? `Demand spike: ${anomaly.productTitle}`
          : `Demand drop: ${anomaly.productTitle}`,
      message:
        anomaly.type === "SPIKE"
          ? `7d velocity (${anomaly.velocity7d.toFixed(1)}/day) is ${anomaly.changeRatio.toFixed(1)}x the 30d baseline. Consider increasing safety stock.`
          : `7d velocity (${anomaly.velocity7d.toFixed(1)}/day) dropped to ${(anomaly.changeRatio * 100).toFixed(0)}% of the 30d baseline.`,
      score: anomaly.severity === "HIGH" ? 90 : 60,
      metadata: { variantId: anomaly.variantId, abc: classifyAbc(anomaly.velocity30d, maxVelocity) },
    });
  }

  return insights.slice(0, 25);
}

export async function persistInventoryInsights(merchantId: number) {
  const insights = await generateInventoryInsights(merchantId);

  await prisma.aiInsight.deleteMany({
    where: {
      merchantId,
      createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  if (insights.length > 0) {
    await prisma.aiInsight.createMany({
      data: insights.map((insight) => ({
        merchantId,
        type: insight.type,
        title: insight.title,
        message: insight.message,
        score: insight.score ?? null,
        metadata: insight.metadata ? JSON.stringify(insight.metadata) : null,
      })),
    });
  }

  return insights;
}

export async function getLatestInventoryInsights(merchantId: number, limit = 20) {
  const stored = await prisma.aiInsight.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (stored.length > 0) {
    return stored;
  }

  const generated = await persistInventoryInsights(merchantId);
  return generated.map((insight, index) => ({
    id: index + 1,
    merchantId,
    type: insight.type,
    title: insight.title,
    message: insight.message,
    score: insight.score ?? null,
    metadata: insight.metadata ? JSON.stringify(insight.metadata) : null,
    createdAt: new Date(),
  }));
}
