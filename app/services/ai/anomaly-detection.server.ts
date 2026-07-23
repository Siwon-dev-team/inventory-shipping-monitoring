import { ProductClassification } from "@prisma/client";

export type VelocityAnomaly = {
  variantId: number;
  productTitle: string;
  sku: string | null;
  velocity7d: number;
  velocity30d: number;
  changeRatio: number;
  type: "SPIKE" | "DROP";
  severity: "HIGH" | "MEDIUM";
};

export function detectVelocityAnomalies(
  rows: Array<{
    variantId: number;
    productTitle: string;
    sku: string | null;
    velocity7d: number;
    velocity30d: number;
    classification: string;
  }>,
): VelocityAnomaly[] {
  const anomalies: VelocityAnomaly[] = [];

  for (const row of rows) {
    if (row.velocity30d <= 0 && row.velocity7d <= 0) continue;

    const baseline = Math.max(row.velocity30d, 0.1);
    const ratio = row.velocity7d / baseline;

    if (ratio >= 1.8) {
      anomalies.push({
        variantId: row.variantId,
        productTitle: row.productTitle,
        sku: row.sku,
        velocity7d: row.velocity7d,
        velocity30d: row.velocity30d,
        changeRatio: ratio,
        type: "SPIKE",
        severity: ratio >= 2.5 ? "HIGH" : "MEDIUM",
      });
      continue;
    }

    if (ratio <= 0.45 && row.classification !== ProductClassification.SLOW_MOVING) {
      anomalies.push({
        variantId: row.variantId,
        productTitle: row.productTitle,
        sku: row.sku,
        velocity7d: row.velocity7d,
        velocity30d: row.velocity30d,
        changeRatio: ratio,
        type: "DROP",
        severity: ratio <= 0.25 ? "HIGH" : "MEDIUM",
      });
    }
  }

  return anomalies.sort((a, b) => {
    const severityScore = { HIGH: 2, MEDIUM: 1 };
    return severityScore[b.severity] - severityScore[a.severity];
  });
}
