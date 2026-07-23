import { AlertStatus } from "@prisma/client";
import prisma from "../../db.server";
import {
  computeDaysOfCover,
  computeOrderByDate,
  computeSellThroughRate,
  computeStockHealthScore,
  computeStockoutDate,
  computeUrgencyScore,
  isDeadStock,
} from "./inventory-metrics.server";

export type ReorderListRow = {
  variantId: number;
  productTitle: string;
  sku: string | null;
  locationId: number | null;
  locationName: string | null;
  inventoryQuantity: number;
  velocity7d: number;
  velocity30d: number;
  forecastDaily: number;
  reorderSuggestionQty: number;
  daysOfCover: number | null;
  stockoutDate: string | null;
  orderByDate: string | null;
  urgencyScore: number;
  alertLevel: string | null;
  classification: string;
  supplierName: string | null;
  supplierLeadTimeDays: number | null;
  sellThroughRate: number | null;
  isDeadStock: boolean;
};

export type ReorderListSummary = {
  stockHealthScore: number;
  totalVariants: number;
  activeAlerts: number;
  needsReorder: number;
  deadStockCount: number;
};

type BuildReorderListOptions = {
  merchantId: number;
  locationId?: number | null;
  needsReorderOnly?: boolean;
  deadStockOnly?: boolean;
};

export async function buildReorderList(
  options: BuildReorderListOptions,
): Promise<{ rows: ReorderListRow[]; summary: ReorderListSummary }> {
  const variants = await prisma.variant.findMany({
    where: { merchantId: options.merchantId },
    include: {
      product: {
        include: {
          supplier: true,
        },
      },
      inventoryLevels: {
        include: {
          location: true,
        },
      },
      inventoryAlerts: {
        where: { alertStatus: AlertStatus.ACTIVE },
      },
    },
  });

  const activeAlertVariantIds = new Set<number>();
  for (const variant of variants) {
    if (variant.inventoryAlerts.length > 0) {
      activeAlertVariantIds.add(variant.id);
    }
  }

  const allRows: ReorderListRow[] = [];

  for (const variant of variants) {
    const forecastDaily = variant.forecastDaily ?? 0;
    const velocity7d = variant.salesVelocity7d ?? 0;
    const velocity30d = variant.salesVelocity30d ?? 0;
    const reorderSuggestionQty = variant.reorderSuggestionQty ?? 0;
    const supplier = variant.product.supplier;
    const leadTimeDays = supplier?.leadTimeDays ?? 0;

    const levels =
      options.locationId != null
        ? variant.inventoryLevels.filter((level) => level.locationId === options.locationId)
        : variant.inventoryLevels;

    const targets =
      levels.length > 0
        ? levels.map((level) => ({
            locationId: level.locationId,
            locationName: level.location.name,
            inventoryQuantity: level.available,
          }))
        : [
            {
              locationId: null as number | null,
              locationName: null as string | null,
              inventoryQuantity: variant.inventoryQuantity,
            },
          ];

    for (const target of targets) {
      const activeAlert = variant.inventoryAlerts.find(
        (alert) =>
          alert.locationId === target.locationId ||
          (alert.locationId == null && target.locationId == null),
      );

      const daysOfCover = computeDaysOfCover(
        target.inventoryQuantity,
        forecastDaily,
      );
      const stockoutDate = computeStockoutDate(
        target.inventoryQuantity,
        forecastDaily,
      );
      const orderByDate = computeOrderByDate(stockoutDate, leadTimeDays);

      const sold30d = velocity30d * 30;
      const urgencyScore = computeUrgencyScore({
        daysOfCover,
        alertLevel: activeAlert?.alertLevel ?? null,
        classification: variant.product.classification,
        reorderSuggestionQty,
      });

      const row: ReorderListRow = {
        variantId: variant.id,
        productTitle: variant.product.title,
        sku: variant.sku,
        locationId: target.locationId,
        locationName: target.locationName,
        inventoryQuantity: target.inventoryQuantity,
        velocity7d,
        velocity30d,
        forecastDaily,
        reorderSuggestionQty,
        daysOfCover,
        stockoutDate: stockoutDate?.toISOString() ?? null,
        orderByDate: orderByDate?.toISOString() ?? null,
        urgencyScore,
        alertLevel: activeAlert?.alertLevel ?? null,
        classification: variant.product.classification,
        supplierName: supplier?.name ?? null,
        supplierLeadTimeDays: supplier?.leadTimeDays ?? null,
        sellThroughRate: computeSellThroughRate(sold30d, target.inventoryQuantity),
        isDeadStock: isDeadStock(sold30d, target.inventoryQuantity),
      };

      allRows.push(row);
    }
  }

  const rows = allRows.filter((row) => {
    if (options.needsReorderOnly) {
      const needsAttention =
        row.reorderSuggestionQty > 0 ||
        row.alertLevel != null ||
        (row.daysOfCover !== null && row.daysOfCover <= 14);
      if (!needsAttention) return false;
    }

    if (options.deadStockOnly && !row.isDeadStock) {
      return false;
    }

    return true;
  });

  rows.sort((a, b) => b.urgencyScore - a.urgencyScore);

  const summary: ReorderListSummary = {
    stockHealthScore: computeStockHealthScore(
      variants.length,
      activeAlertVariantIds.size,
    ),
    totalVariants: variants.length,
    activeAlerts: activeAlertVariantIds.size,
    needsReorder: allRows.filter((row) => row.reorderSuggestionQty > 0).length,
    deadStockCount: allRows.filter((row) => row.isDeadStock).length,
  };

  return { rows, summary };
}

export function reorderListToCsv(rows: ReorderListRow[]): string {
  const headers = [
    "Product",
    "SKU",
    "Location",
    "On hand",
    "Velocity 7d",
    "Velocity 30d",
    "Days of cover",
    "Stockout date",
    "Order by date",
    "Reorder qty",
    "Urgency",
    "Alert level",
    "Supplier",
    "Lead time (days)",
    "Classification",
    "Sell-through",
    "Dead stock",
  ];

  const lines = rows.map((row) =>
    [
      row.productTitle,
      row.sku ?? "",
      row.locationName ?? "",
      row.inventoryQuantity,
      row.velocity7d,
      row.velocity30d,
      row.daysOfCover ?? "",
      row.stockoutDate ? row.stockoutDate.slice(0, 10) : "",
      row.orderByDate ? row.orderByDate.slice(0, 10) : "",
      row.reorderSuggestionQty,
      row.urgencyScore,
      row.alertLevel ?? "",
      row.supplierName ?? "",
      row.supplierLeadTimeDays ?? "",
      row.classification,
      row.sellThroughRate ?? "",
      row.isDeadStock ? "yes" : "no",
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );

  return [headers.join(","), ...lines].join("\n");
}
