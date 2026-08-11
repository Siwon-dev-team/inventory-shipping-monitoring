import { buildReorderList } from "../inventory/reorder-list.server";
import { createPurchaseOrdersFromReorderRows } from "../inventory/purchase-orders.server";
import prisma from "../../db.server";

export type AiFunctionName =
  | "get_reorder_priorities"
  | "get_inventory_summary"
  | "get_stockout_risks"
  | "create_purchase_orders"
  | "get_dead_stock"
  | "get_supplier_info";

export type AiFunctionResult = {
  success: boolean;
  data: unknown;
  message: string;
};

const FUNCTION_DEFINITIONS = [
  {
    name: "get_reorder_priorities",
    description: "Get the top products that need to be reordered based on urgency score",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of products to return (default 10)",
        },
      },
    },
  },
  {
    name: "get_inventory_summary",
    description: "Get overall inventory health summary including stock health score, alerts count, and key metrics",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_stockout_risks",
    description: "Get products at risk of running out of stock within the next 7-14 days",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look ahead for stockout risk (default 14)",
        },
      },
    },
  },
  {
    name: "create_purchase_orders",
    description: "Create draft purchase orders for products that need reordering. Only use when explicitly asked to create POs.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of products to include (default 20)",
        },
      },
    },
  },
  {
    name: "get_dead_stock",
    description: "Get products that haven't sold in the last 30 days (dead stock)",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of products to return (default 20)",
        },
      },
    },
  },
  {
    name: "get_supplier_info",
    description: "Get information about suppliers and their associated products",
    parameters: {
      type: "object",
      properties: {
        supplierId: {
          type: "number",
          description: "Specific supplier ID to get info for (optional)",
        },
      },
    },
  },
];

export function getFunctionDefinitions() {
  return FUNCTION_DEFINITIONS;
}

export async function executeFunction(
  merchantId: number,
  functionName: AiFunctionName,
  args: Record<string, unknown>,
): Promise<AiFunctionResult> {
  switch (functionName) {
    case "get_reorder_priorities":
      return await getReorderPriorities(merchantId, args.limit as number | undefined);

    case "get_inventory_summary":
      return await getInventorySummary(merchantId);

    case "get_stockout_risks":
      return await getStockoutRisks(merchantId, args.days as number | undefined);

    case "create_purchase_orders":
      return await createPurchaseOrdersAction(merchantId, args.limit as number | undefined);

    case "get_dead_stock":
      return await getDeadStock(merchantId, args.limit as number | undefined);

    case "get_supplier_info":
      return await getSupplierInfo(merchantId, args.supplierId as number | undefined);

    default:
      return {
        success: false,
        data: null,
        message: `Unknown function: ${functionName}`,
      };
  }
}

async function getReorderPriorities(
  merchantId: number,
  limit = 10,
): Promise<AiFunctionResult> {
  const { rows, summary } = await buildReorderList({
    merchantId,
    needsReorderOnly: true,
  });

  const topRows = rows.slice(0, limit).map((row) => ({
    product: row.productTitle,
    sku: row.sku,
    currentStock: row.inventoryQuantity,
    suggestedReorder: row.reorderSuggestionQty,
    urgencyScore: row.urgencyScore,
    daysOfCover: row.daysOfCover,
    stockoutDate: row.stockoutDate,
    supplier: row.supplierName,
  }));

  return {
    success: true,
    data: { products: topRows, totalNeedingReorder: summary.needsReorder },
    message: `Found ${topRows.length} products needing reorder out of ${summary.needsReorder} total.`,
  };
}

async function getInventorySummary(merchantId: number): Promise<AiFunctionResult> {
  const { summary } = await buildReorderList({ merchantId });

  const activeAlerts = await prisma.inventoryAlert.count({
    where: { merchantId, alertStatus: "ACTIVE" },
  });

  const criticalAlerts = await prisma.inventoryAlert.count({
    where: { merchantId, alertStatus: "ACTIVE", alertLevel: "CRITICAL" },
  });

  return {
    success: true,
    data: {
      stockHealthScore: summary.stockHealthScore,
      totalSKUs: summary.needsReorder + (100 - summary.stockHealthScore),
      skusNeedingReorder: summary.needsReorder,
      deadStockCount: summary.deadStockCount,
      activeAlerts,
      criticalAlerts,
    },
    message: `Inventory health is ${summary.stockHealthScore}%. ${summary.needsReorder} SKUs need reorder, ${summary.deadStockCount} are dead stock.`,
  };
}

async function getStockoutRisks(
  merchantId: number,
  days = 14,
): Promise<AiFunctionResult> {
  const { rows } = await buildReorderList({ merchantId, needsReorderOnly: true });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + days);

  const atRisk = rows
    .filter((row) => {
      if (!row.stockoutDate) return false;
      return new Date(row.stockoutDate) <= cutoffDate;
    })
    .slice(0, 20)
    .map((row) => ({
      product: row.productTitle,
      sku: row.sku,
      currentStock: row.inventoryQuantity,
      stockoutDate: row.stockoutDate,
      daysUntilStockout: row.daysOfCover,
      urgencyScore: row.urgencyScore,
    }));

  return {
    success: true,
    data: { productsAtRisk: atRisk, riskWindow: days },
    message: `${atRisk.length} products at risk of stockout within ${days} days.`,
  };
}

async function createPurchaseOrdersAction(
  merchantId: number,
  limit = 20,
): Promise<AiFunctionResult> {
  const { rows } = await buildReorderList({ merchantId, needsReorderOnly: true });
  const topRows = rows.slice(0, limit);

  if (topRows.length === 0) {
    return {
      success: true,
      data: { purchaseOrdersCreated: 0 },
      message: "No products currently need reordering.",
    };
  }

  const created = await createPurchaseOrdersFromReorderRows(merchantId, topRows);

  return {
    success: true,
    data: {
      purchaseOrdersCreated: created.length,
      poIds: created.map((po) => po.id),
    },
    message: `Created ${created.length} draft purchase order(s) for ${topRows.length} products. Review them in Purchase Orders.`,
  };
}

async function getDeadStock(
  merchantId: number,
  limit = 20,
): Promise<AiFunctionResult> {
  const { rows } = await buildReorderList({ merchantId, deadStockOnly: true });

  const deadStockItems = rows.slice(0, limit).map((row) => ({
    product: row.productTitle,
    sku: row.sku,
    currentStock: row.inventoryQuantity,
    sellThroughRate: row.sellThroughRate,
    classification: row.classification,
  }));

  return {
    success: true,
    data: { deadStockItems, totalDeadStock: rows.length },
    message: `Found ${rows.length} dead stock items (no sales in 30+ days). Consider markdowns or promotions.`,
  };
}

async function getSupplierInfo(
  merchantId: number,
  supplierId?: number,
): Promise<AiFunctionResult> {
  const where = supplierId
    ? { merchantId, id: supplierId }
    : { merchantId };

  const suppliers = await prisma.supplier.findMany({
    where,
    include: {
      _count: { select: { products: true, purchaseOrders: true } },
    },
  });

  const supplierData = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    leadTimeDays: s.leadTimeDays,
    productCount: s._count.products,
    purchaseOrderCount: s._count.purchaseOrders,
  }));

  return {
    success: true,
    data: { suppliers: supplierData },
    message: `Found ${suppliers.length} supplier(s).`,
  };
}
