import prisma from "../../db.server";

type OrdersQueryResult = {
  orders: {
    edges: Array<{
      node: {
        id: string;
        createdAt: string;
        lineItems: {
          edges: Array<{
            node: {
              variant: { id: string } | null;
              quantity: number;
              originalUnitPriceSet: {
                shopMoney: { amount: string };
              };
            };
          }>;
        };
      };
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
};

const ORDERS_QUERY = `
  query GetOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                variant {
                  id
                }
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export async function syncOrderHistory(
  merchantId: number,
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  daysBack = 365,
) {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);
  const query = `created_at:>='${sinceDate.toISOString().split("T")[0]}'`;

  let hasNextPage = true;
  let cursor: string | null = null;
  let totalOrders = 0;
  let totalSnapshots = 0;

  // Get all variant mappings for this merchant
  const variants = await prisma.variant.findMany({
    where: { merchantId },
    select: { id: true, shopifyVariantId: true },
  });

  const variantMap = new Map(variants.map((v) => [v.shopifyVariantId, v.id]));

  while (hasNextPage) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: {
        first: 50,
        after: cursor,
        query,
      },
    });

    const result = (await response.json()) as { data: OrdersQueryResult };
    const orders = result.data.orders;

    for (const edge of orders.edges) {
      const order = edge.node;
      const orderDate = new Date(order.createdAt);
      orderDate.setHours(0, 0, 0, 0);

      for (const lineEdge of order.lineItems.edges) {
        const line = lineEdge.node;
        if (!line.variant?.id) continue;

        const variantId = variantMap.get(line.variant.id);
        if (!variantId) continue;

        const revenue = parseFloat(line.originalUnitPriceSet.shopMoney.amount) * line.quantity;

        // Upsert daily snapshot
        await prisma.dailySalesSnapshot.upsert({
          where: {
            merchantId_variantId_date: {
              merchantId,
              variantId,
              date: orderDate,
            },
          },
          create: {
            merchantId,
            variantId,
            date: orderDate,
            quantitySold: line.quantity,
            revenue,
          },
          update: {
            quantitySold: { increment: line.quantity },
            revenue: { increment: revenue },
          },
        });

        totalSnapshots++;
      }

      totalOrders++;
    }

    hasNextPage = orders.pageInfo.hasNextPage;
    cursor = orders.pageInfo.endCursor;
  }

  return { totalOrders, totalSnapshots };
}

export async function getDailySalesForVariant(
  variantId: number,
  daysBack = 30,
): Promise<Array<{ date: Date; quantitySold: number; revenue: number }>> {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);

  return prisma.dailySalesSnapshot.findMany({
    where: {
      variantId,
      date: { gte: sinceDate },
    },
    orderBy: { date: "asc" },
  });
}

export async function getHistoricalVelocity(
  variantId: number,
  daysBack = 30,
): Promise<number> {
  const snapshots = await getDailySalesForVariant(variantId, daysBack);

  if (snapshots.length === 0) return 0;

  const totalSold = snapshots.reduce((sum, s) => sum + s.quantitySold, 0);
  return totalSold / daysBack;
}

export async function detectSeasonalPattern(
  variantId: number,
): Promise<{
  hasSeasonality: boolean;
  peakMonths: number[];
  lowMonths: number[];
  seasonalityScore: number;
}> {
  // Get last 12 months of data
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const snapshots = await prisma.dailySalesSnapshot.findMany({
    where: {
      variantId,
      date: { gte: oneYearAgo },
    },
    orderBy: { date: "asc" },
  });

  if (snapshots.length < 30) {
    return { hasSeasonality: false, peakMonths: [], lowMonths: [], seasonalityScore: 0 };
  }

  // Aggregate by month
  const monthlyTotals = new Map<number, number>();
  for (const snapshot of snapshots) {
    const month = snapshot.date.getMonth();
    monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + snapshot.quantitySold);
  }

  const values = Array.from(monthlyTotals.values());
  if (values.length < 3) {
    return { hasSeasonality: false, peakMonths: [], lowMonths: [], seasonalityScore: 0 };
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = avg > 0 ? stdDev / avg : 0;

  // Find peak and low months (> 1.5x or < 0.5x average)
  const peakMonths: number[] = [];
  const lowMonths: number[] = [];

  monthlyTotals.forEach((total, month) => {
    if (total > avg * 1.5) peakMonths.push(month);
    if (total < avg * 0.5) lowMonths.push(month);
  });

  // Score: higher CV = more seasonality
  const seasonalityScore = Math.min(100, Math.round(coefficientOfVariation * 100));
  const hasSeasonality = seasonalityScore > 30;

  return { hasSeasonality, peakMonths, lowMonths, seasonalityScore };
}
