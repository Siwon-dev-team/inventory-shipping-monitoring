export type AbcClass = "A" | "B" | "C";

export type AbcAnalyticsRow = {
  variantId: number;
  productTitle: string;
  sku: string | null;
  velocity30d: number;
  sellThroughRate: number | null;
  inventoryQuantity: number;
  classification: string;
  abcClass: AbcClass;
  isDeadStock: boolean;
};

export function classifyAbcByVelocity(
  velocity30d: number,
  maxVelocity: number,
): AbcClass {
  if (maxVelocity <= 0) return "C";
  const ratio = velocity30d / maxVelocity;
  if (ratio >= 0.7) return "A";
  if (ratio >= 0.3) return "B";
  return "C";
}

export function buildAbcAnalyticsRows(
  variants: Array<{
    id: number;
    sku: string | null;
    inventoryQuantity: number;
    salesVelocity30d: number | null;
    product: {
      title: string;
      classification: string;
    };
  }>,
  sellThroughByVariant: Map<number, number | null>,
  deadStockVariantIds: Set<number>,
): AbcAnalyticsRow[] {
  const maxVelocity = Math.max(
    ...variants.map((variant) => variant.salesVelocity30d ?? 0),
    0,
  );

  const rows = variants.map((variant) => {
    const velocity30d = variant.salesVelocity30d ?? 0;
    return {
      variantId: variant.id,
      productTitle: variant.product.title,
      sku: variant.sku,
      velocity30d,
      sellThroughRate: sellThroughByVariant.get(variant.id) ?? null,
      inventoryQuantity: variant.inventoryQuantity,
      classification: variant.product.classification,
      abcClass: classifyAbcByVelocity(velocity30d, maxVelocity),
      isDeadStock: deadStockVariantIds.has(variant.id),
    };
  });

  return rows.sort((a, b) => {
    const classOrder = { A: 0, B: 1, C: 2 };
    if (classOrder[a.abcClass] !== classOrder[b.abcClass]) {
      return classOrder[a.abcClass] - classOrder[b.abcClass];
    }
    return b.velocity30d - a.velocity30d;
  });
}

export function abcAnalyticsToCsv(rows: AbcAnalyticsRow[]): string {
  const headers = [
    "ABC class",
    "Product",
    "SKU",
    "Velocity 30d",
    "Sell-through",
    "On hand",
    "Classification",
    "Dead stock",
  ];

  const lines = rows.map((row) =>
    [
      row.abcClass,
      row.productTitle,
      row.sku ?? "",
      row.velocity30d,
      row.sellThroughRate ?? "",
      row.inventoryQuantity,
      row.classification,
      row.isDeadStock ? "yes" : "no",
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );

  return [headers.join(","), ...lines].join("\n");
}
