import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import prisma from "../db.server";
import {
  abcAnalyticsToCsv,
  buildAbcAnalyticsRows,
  type AbcClass,
} from "../services/inventory/abc-analytics.server";
import {
  computeSellThroughRate,
  isDeadStock,
} from "../services/inventory/inventory-metrics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const url = new URL(request.url);
  const filter = (url.searchParams.get("class") ?? "all") as AbcClass | "all";

  const variants = await prisma.variant.findMany({
    where: { merchantId: merchant.id },
    include: { product: true },
  });

  const sellThroughByVariant = new Map<number, number | null>();
  const deadStockVariantIds = new Set<number>();

  for (const variant of variants) {
    const velocity30d = variant.salesVelocity30d ?? 0;
    const sold30d = velocity30d * 30;
    sellThroughByVariant.set(
      variant.id,
      computeSellThroughRate(sold30d, variant.inventoryQuantity),
    );
    if (isDeadStock(sold30d, variant.inventoryQuantity)) {
      deadStockVariantIds.add(variant.id);
    }
  }

  const rows = buildAbcAnalyticsRows(variants, sellThroughByVariant, deadStockVariantIds);
  const filteredRows =
    filter === "all" ? rows : rows.filter((row) => row.abcClass === filter);
  const csv = abcAnalyticsToCsv(filteredRows);
  const timestamp = new Date().toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="abc-analytics-${timestamp}.csv"`,
    },
  });
};
