import { PurchaseOrderStatus } from "@prisma/client";
import prisma from "../../db.server";
import { sendEmail } from "../notifications/email.server";
import {
  adjustShopifyInventory,
  toInventoryItemGid,
  toLocationGid,
} from "./inventory-receive.server";
import { monitorVariantQuantity } from "./monitor.server";
import type { ReorderListRow } from "./reorder-list.server";
import { recomputeMerchantForecasts } from "./forecast.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CreatePurchaseOrderInput = {
  merchantId: number;
  supplierId?: number | null;
  notes?: string | null;
  lines: Array<{
    variantId?: number | null;
    locationId?: number | null;
    productTitle: string;
    sku?: string | null;
    locationName?: string | null;
    quantity: number;
  }>;
};

export async function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  if (input.lines.length === 0) {
    throw new Error("Purchase order must include at least one line item.");
  }

  return prisma.purchaseOrder.create({
    data: {
      merchantId: input.merchantId,
      supplierId: input.supplierId ?? null,
      notes: input.notes ?? null,
      status: PurchaseOrderStatus.DRAFT,
      lines: {
        create: input.lines.map((line) => ({
          variantId: line.variantId ?? null,
          locationId: line.locationId ?? null,
          productTitle: line.productTitle,
          sku: line.sku ?? null,
          locationName: line.locationName ?? null,
          quantity: line.quantity,
        })),
      },
    },
    include: {
      supplier: true,
      lines: true,
    },
  });
}

export async function createPurchaseOrdersFromReorderRows(
  merchantId: number,
  rows: ReorderListRow[],
) {
  const eligibleRows = rows.filter((row) => row.reorderSuggestionQty > 0);
  if (eligibleRows.length === 0) {
    return [];
  }

  const grouped = new Map<string, ReorderListRow[]>();
  for (const row of eligibleRows) {
    const key = row.supplierName ?? "unassigned";
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const created = [];
  for (const [supplierName, supplierRows] of grouped) {
    const supplier =
      supplierName === "unassigned"
        ? null
        : await prisma.supplier.findFirst({
            where: { merchantId, name: supplierName },
          });

    const po = await createPurchaseOrder({
      merchantId,
      supplierId: supplier?.id ?? null,
      notes:
        supplierName === "unassigned"
          ? "Created from reorder list without assigned supplier."
          : `Auto-created for supplier ${supplierName}.`,
      lines: supplierRows.map((row) => ({
        variantId: row.variantId,
        locationId: row.locationId,
        productTitle: row.productTitle,
        sku: row.sku,
        locationName: row.locationName,
        quantity: row.reorderSuggestionQty,
      })),
    });
    created.push(po);
  }

  return created;
}

function formatPurchaseOrderEmail(po: {
  id: number;
  notes: string | null;
  supplier: { name: string } | null;
  lines: Array<{
    productTitle: string;
    sku: string | null;
    locationName: string | null;
    quantity: number;
  }>;
}) {
  const lines = [
    `Purchase Order #${po.id}`,
    po.supplier ? `Supplier: ${po.supplier.name}` : "Supplier: Unassigned",
    "",
    ...po.lines.map(
      (line) =>
        `- ${line.productTitle} (${line.sku || "no SKU"}) @ ${line.locationName || "default"}: qty ${line.quantity}`,
    ),
  ];

  if (po.notes) {
    lines.push("", `Notes: ${po.notes}`);
  }

  return lines.join("\n");
}

export async function sendPurchaseOrderEmail(purchaseOrderId: number, merchantId: number) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, merchantId },
    include: {
      supplier: true,
      lines: true,
      merchant: true,
    },
  });

  if (!po) {
    throw new Error("Purchase order not found.");
  }

  const recipient = po.supplier?.email || po.merchant.contactEmail || process.env.ALERT_EMAIL_TO;
  if (!recipient) {
    throw new Error("No supplier email or merchant contact email configured.");
  }

  await sendEmail({
    to: recipient,
    subject: `[PO #${po.id}] Reorder request from ${po.merchant.shopDomain}`,
    text: formatPurchaseOrderEmail(po),
  });

  return prisma.purchaseOrder.update({
    where: { id: po.id },
    data: {
      status: PurchaseOrderStatus.SENT,
      sentAt: new Date(),
    },
    include: { supplier: true, lines: true },
  });
}

async function resolveReceiveTarget(line: {
  variantId: number | null;
  locationId: number | null;
  merchantId: number;
}) {
  if (!line.variantId) {
    throw new Error("Purchase order line is missing a variant reference.");
  }

  const variant = await prisma.variant.findFirst({
    where: { id: line.variantId, merchantId: line.merchantId },
    include: {
      product: true,
      inventoryLevels: {
        include: { location: true },
      },
    },
  });

  if (!variant) {
    throw new Error(`Variant ${line.variantId} not found.`);
  }

  if (!variant.shopifyInventoryItemId) {
    throw new Error(`Variant ${variant.sku || variant.id} is missing inventory item ID.`);
  }

  let location =
    line.locationId != null
      ? variant.inventoryLevels.find((level) => level.locationId === line.locationId)?.location
      : variant.inventoryLevels[0]?.location;

  if (!location) {
    location =
      (await prisma.location.findFirst({
        where: { merchantId: line.merchantId },
        orderBy: { id: "asc" },
      })) ?? undefined;
  }

  if (!location) {
    throw new Error("No Shopify location found for inventory receive.");
  }

  return { variant, location };
}

export async function markPurchaseOrderReceived(
  purchaseOrderId: number,
  merchantId: number,
  admin: AdminGraphqlClient,
) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, merchantId },
    include: {
      lines: true,
    },
  });

  if (!po) {
    throw new Error("Purchase order not found.");
  }

  if (po.status !== PurchaseOrderStatus.SENT && po.status !== PurchaseOrderStatus.DRAFT) {
    throw new Error("Only draft or sent purchase orders can be received.");
  }

  const settings = await prisma.settings.findUnique({
    where: { merchantId },
  });
  if (!settings) {
    throw new Error("Merchant settings not found.");
  }

  for (const line of po.lines) {
    const { variant, location } = await resolveReceiveTarget({
      variantId: line.variantId,
      locationId: line.locationId,
      merchantId,
    });

    await adjustShopifyInventory({
      admin,
      inventoryItemGid: toInventoryItemGid(variant.shopifyInventoryItemId!),
      locationGid: toLocationGid(location.shopifyLocationId),
      delta: line.quantity,
      reason: "received",
    });

    const inventoryLevel = await prisma.variantInventory.upsert({
      where: {
        variantId_locationId: {
          variantId: variant.id,
          locationId: location.id,
        },
      },
      update: {
        available: { increment: line.quantity },
      },
      create: {
        variantId: variant.id,
        locationId: location.id,
        available: line.quantity,
      },
    });

    const totalAvailable = await prisma.variantInventory.aggregate({
      where: { variantId: variant.id },
      _sum: { available: true },
    });
    const inventoryQuantity = totalAvailable._sum.available ?? inventoryLevel.available;

    const updatedVariant = await prisma.variant.update({
      where: { id: variant.id },
      data: {
        inventoryQuantity,
        lastInventorySyncAt: new Date(),
      },
    });

    await monitorVariantQuantity({
      merchantId,
      settings,
      product: variant.product,
      variant: updatedVariant,
      location,
      currentQuantity: inventoryLevel.available,
    });
  }

  await recomputeMerchantForecasts(merchantId);

  return prisma.purchaseOrder.update({
    where: { id: po.id },
    data: {
      status: PurchaseOrderStatus.RECEIVED,
      receivedAt: new Date(),
    },
    include: { supplier: true, lines: true },
  });
}

export async function cancelPurchaseOrder(purchaseOrderId: number, merchantId: number) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, merchantId },
  });

  if (!po) {
    throw new Error("Purchase order not found.");
  }

  return prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { status: PurchaseOrderStatus.CANCELLED },
    include: { supplier: true, lines: true },
  });
}
