import prisma from "../../db.server";
import { getDailySalesForVariant, detectSeasonalPattern } from "../sync/order-history.server";

export type ForecastResult = {
  variantId: number;
  forecastDaily: number;
  forecast7d: number;
  forecast30d: number;
  confidence: number;
  method: "simple" | "weighted" | "seasonal";
  seasonalAdjustment: number;
  trend: "up" | "down" | "stable";
};

export async function generateForecast(variantId: number): Promise<ForecastResult> {
  const salesData = await getDailySalesForVariant(variantId, 90);
  const seasonality = await detectSeasonalPattern(variantId);

  if (salesData.length < 7) {
    // Not enough data - use simple average
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: { salesVelocity30d: true },
    });

    const velocity = variant?.salesVelocity30d ?? 0;

    return {
      variantId,
      forecastDaily: velocity,
      forecast7d: velocity * 7,
      forecast30d: velocity * 30,
      confidence: 20,
      method: "simple",
      seasonalAdjustment: 1,
      trend: "stable",
    };
  }

  // Calculate weighted moving average (recent data weighted more)
  const recentDays = salesData.slice(-30);
  const olderDays = salesData.slice(-90, -30);

  const recentAvg = recentDays.length > 0
    ? recentDays.reduce((sum, d) => sum + d.quantitySold, 0) / recentDays.length
    : 0;

  const olderAvg = olderDays.length > 0
    ? olderDays.reduce((sum, d) => sum + d.quantitySold, 0) / olderDays.length
    : recentAvg;

  // Weighted: 70% recent, 30% older
  let forecastDaily = recentAvg * 0.7 + olderAvg * 0.3;

  // Detect trend
  const trend = recentAvg > olderAvg * 1.1
    ? "up"
    : recentAvg < olderAvg * 0.9
      ? "down"
      : "stable";

  // Apply trend adjustment
  if (trend === "up") {
    forecastDaily *= 1.1;
  } else if (trend === "down") {
    forecastDaily *= 0.9;
  }

  // Apply seasonal adjustment if applicable
  let seasonalAdjustment = 1;
  let method: "simple" | "weighted" | "seasonal" = "weighted";

  if (seasonality.hasSeasonality) {
    const currentMonth = new Date().getMonth();

    if (seasonality.peakMonths.includes(currentMonth)) {
      seasonalAdjustment = 1.3;
    } else if (seasonality.lowMonths.includes(currentMonth)) {
      seasonalAdjustment = 0.7;
    }

    forecastDaily *= seasonalAdjustment;
    method = "seasonal";
  }

  // Calculate confidence based on data quality
  const dataPoints = salesData.length;
  const hasSeasonalData = seasonality.hasSeasonality;
  const variance = calculateVariance(recentDays.map((d) => d.quantitySold));
  const coefficientOfVariation = recentAvg > 0 ? Math.sqrt(variance) / recentAvg : 1;

  let confidence = 50; // Base confidence
  confidence += Math.min(30, dataPoints); // More data = more confident
  confidence -= Math.min(30, coefficientOfVariation * 50); // High variance = less confident
  if (hasSeasonalData) confidence += 10;
  confidence = Math.max(10, Math.min(95, confidence));

  return {
    variantId,
    forecastDaily,
    forecast7d: forecastDaily * 7,
    forecast30d: forecastDaily * 30,
    confidence: Math.round(confidence),
    method,
    seasonalAdjustment,
    trend,
  };
}

export async function updateVariantForecasts(merchantId: number): Promise<number> {
  const variants = await prisma.variant.findMany({
    where: { merchantId },
    select: { id: true },
  });

  let updated = 0;

  for (const variant of variants) {
    const forecast = await generateForecast(variant.id);

    await prisma.variant.update({
      where: { id: variant.id },
      data: {
        forecastDaily: forecast.forecastDaily,
        forecast7d: forecast.forecast7d,
        forecast30d: forecast.forecast30d,
      },
    });

    updated++;
  }

  return updated;
}

export async function getForecastSummary(merchantId: number): Promise<{
  totalForecasted: number;
  avgConfidence: number;
  upTrend: number;
  downTrend: number;
  stable: number;
}> {
  const variants = await prisma.variant.findMany({
    where: { merchantId },
    select: { id: true },
  });

  let totalConfidence = 0;
  let upTrend = 0;
  let downTrend = 0;
  let stable = 0;

  for (const variant of variants) {
    const forecast = await generateForecast(variant.id);
    totalConfidence += forecast.confidence;

    switch (forecast.trend) {
      case "up":
        upTrend++;
        break;
      case "down":
        downTrend++;
        break;
      default:
        stable++;
    }
  }

  return {
    totalForecasted: variants.length,
    avgConfidence: variants.length > 0 ? Math.round(totalConfidence / variants.length) : 0,
    upTrend,
    downTrend,
    stable,
  };
}

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
}
