import type { AlertLevel, ProductClassification } from "@prisma/client";

export function computeDaysOfCover(
  inventoryQuantity: number,
  forecastDaily: number,
): number | null {
  if (forecastDaily <= 0) return null;
  return Math.round((inventoryQuantity / forecastDaily) * 100) / 100;
}

export function computeStockoutDate(
  inventoryQuantity: number,
  forecastDaily: number,
  fromDate: Date = new Date(),
): Date | null {
  const daysOfCover = computeDaysOfCover(inventoryQuantity, forecastDaily);
  if (daysOfCover === null) return null;

  const stockoutDate = new Date(fromDate);
  stockoutDate.setDate(stockoutDate.getDate() + Math.ceil(daysOfCover));
  return stockoutDate;
}

export function computeOrderByDate(
  stockoutDate: Date | null,
  leadTimeDays: number,
): Date | null {
  if (!stockoutDate) return null;

  const orderByDate = new Date(stockoutDate);
  orderByDate.setDate(orderByDate.getDate() - Math.max(0, leadTimeDays));
  return orderByDate;
}

export function computeUrgencyScore(input: {
  daysOfCover: number | null;
  alertLevel?: AlertLevel | null;
  classification?: ProductClassification | null;
  reorderSuggestionQty: number;
}): number {
  let score = 0;

  if (input.alertLevel === "OUT_OF_STOCK") score += 100;
  else if (input.alertLevel === "CRITICAL") score += 70;
  else if (input.alertLevel === "LOW") score += 40;

  if (input.daysOfCover !== null) {
    if (input.daysOfCover <= 3) score += 30;
    else if (input.daysOfCover <= 7) score += 15;
    else if (input.daysOfCover <= 14) score += 5;
  }

  if (input.classification === "FAST_MOVING") score += 10;
  if (input.reorderSuggestionQty > 0) score += 5;

  return Math.min(100, score);
}

export function computeStockHealthScore(
  totalVariants: number,
  variantsWithActiveAlert: number,
): number {
  if (totalVariants === 0) return 100;
  const healthy = totalVariants - variantsWithActiveAlert;
  return Math.round((healthy / totalVariants) * 100);
}

export function computeSellThroughRate(
  sold30d: number,
  inventoryQuantity: number,
): number | null {
  const denominator = sold30d + inventoryQuantity;
  if (denominator <= 0) return null;
  return Math.round((sold30d / denominator) * 1000) / 1000;
}

export function isDeadStock(
  sold30d: number,
  inventoryQuantity: number,
): boolean {
  return inventoryQuantity > 0 && sold30d <= 0;
}
