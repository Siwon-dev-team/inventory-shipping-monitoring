import { ProductClassification } from "@prisma/client";
import prisma from "../../db.server";

type ForecastSummary = {
  variantsUpdated: number;
  productsUpdated: number;
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function classifyVariant(velocity7d: number, velocity30d: number) {
  const fastThresholdDaily = 20 / 7;
  const slowThresholdDaily = 5 / 7;

  if (velocity7d >= Math.max(velocity30d * 1.5, fastThresholdDaily)) {
    return ProductClassification.FAST_MOVING;
  }

  if (velocity7d <= Math.min(velocity30d * 0.5, slowThresholdDaily)) {
    return ProductClassification.SLOW_MOVING;
  }

  return ProductClassification.STABLE;
}

export function computeForecastMetrics(input: {
  sold7d: number;
  sold30d: number;
  inventoryQuantity: number;
  safetyBufferDays: number;
}) {
  const velocity7d = input.sold7d / 7;
  const velocity30d = input.sold30d / 30;
  const forecastDaily = velocity7d * 0.6 + velocity30d * 0.4;
  const forecast7d = forecastDaily * 7;
  const forecast30d = forecastDaily * 30;
  const safetyStock = velocity30d * input.safetyBufferDays;
  const reorderSuggestionQty = Math.max(
    0,
    Math.ceil(forecast30d + safetyStock - input.inventoryQuantity),
  );

  return {
    velocity7d: round(velocity7d),
    velocity30d: round(velocity30d),
    forecastDaily: round(forecastDaily),
    forecast7d: round(forecast7d),
    forecast30d: round(forecast30d),
    reorderSuggestionQty,
  };
}

export async function recomputeMerchantForecasts(
  merchantId: number,
): Promise<ForecastSummary> {
  const settings = await prisma.settings.findUnique({
    where: { merchantId },
  });
  if (!settings) {
    return { variantsUpdated: 0, productsUpdated: 0 };
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const variants = await prisma.variant.findMany({
    where: { merchantId },
    include: {
      salesData: true,
    },
  });

  const productClassifications = new Map<number, ProductClassification[]>();

  for (const variant of variants) {
    const sold7d = variant.salesData
      .filter((entry) => entry.date >= sevenDaysAgo)
      .reduce((sum, entry) => sum + entry.quantitySold, 0);
    const sold30d = variant.salesData
      .filter((entry) => entry.date >= thirtyDaysAgo)
      .reduce((sum, entry) => sum + entry.quantitySold, 0);

    const metrics = computeForecastMetrics({
      sold7d,
      sold30d,
      inventoryQuantity: variant.inventoryQuantity,
      safetyBufferDays: settings.safetyBufferDays,
    });

    const classification = classifyVariant(
      metrics.velocity7d,
      metrics.velocity30d,
    );
    const classifications = productClassifications.get(variant.productId) ?? [];
    classifications.push(classification);
    productClassifications.set(variant.productId, classifications);

    await prisma.variant.update({
      where: { id: variant.id },
      data: {
        salesVelocity7d: metrics.velocity7d,
        salesVelocity30d: metrics.velocity30d,
        forecastDaily: metrics.forecastDaily,
        forecast7d: metrics.forecast7d,
        forecast30d: metrics.forecast30d,
        reorderSuggestionQty: metrics.reorderSuggestionQty,
      },
    });
  }

  for (const [productId, classifications] of productClassifications) {
    const hasFast = classifications.includes(ProductClassification.FAST_MOVING);
    const allSlow =
      classifications.length > 0 &&
      classifications.every((value) => value === ProductClassification.SLOW_MOVING);

    const productClassification = hasFast
      ? ProductClassification.FAST_MOVING
      : allSlow
        ? ProductClassification.SLOW_MOVING
        : ProductClassification.STABLE;

    await prisma.product.update({
      where: { id: productId },
      data: {
        classification: productClassification,
      },
    });
  }

  return {
    variantsUpdated: variants.length,
    productsUpdated: productClassifications.size,
  };
}

