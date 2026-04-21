import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { monitorVariantQuantity } from "../services/inventory/monitor.server";
import { normalizeShopifyId } from "../services/shopify-id.server";
import { markWebhookProcessed } from "../services/webhook-idempotency.server";

type InventoryLevelsWebhookPayload = {
  inventory_item_id?: number;
  location_id?: number;
  available?: number;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const { topic, shop, payload } = await authenticate.webhook(request);
  if (topic !== "INVENTORY_LEVELS_UPDATE") {
    return new Response("Unhandled topic", { status: 200 });
  }

  const parsed = payload as InventoryLevelsWebhookPayload;
  if (
    !parsed.inventory_item_id ||
    !parsed.location_id ||
    typeof parsed.available !== "number"
  ) {
    return new Response("Invalid payload", { status: 200 });
  }

  const merchant = await ensureMerchantSetup(shop);
  if (webhookId) {
    const accepted = await markWebhookProcessed({
      merchantId: merchant.id,
      shopDomain: shop,
      topic,
      webhookId,
      payloadHash: JSON.stringify(payload),
    });
    if (!accepted) {
      return new Response("Duplicate webhook ignored", { status: 200 });
    }
  }

  const variant = await prisma.variant.findFirst({
    where: {
      merchantId: merchant.id,
      shopifyInventoryItemId:
        normalizeShopifyId(parsed.inventory_item_id) ?? String(parsed.inventory_item_id),
    },
    include: {
      product: true,
      merchant: {
        include: {
          settings: true,
        },
      },
    },
  });

  if (!variant || !variant.merchant.settings) {
    return new Response("Variant not tracked", { status: 200 });
  }

  const location = await prisma.location.upsert({
    where: {
      merchantId_shopifyLocationId: {
        merchantId: merchant.id,
        shopifyLocationId:
          normalizeShopifyId(parsed.location_id) ?? String(parsed.location_id),
      },
    },
    update: {},
    create: {
      merchantId: merchant.id,
      shopifyLocationId:
        normalizeShopifyId(parsed.location_id) ?? String(parsed.location_id),
      name: `Location ${parsed.location_id}`,
    },
  });

  await prisma.variantInventory.upsert({
    where: {
      variantId_locationId: {
        variantId: variant.id,
        locationId: location.id,
      },
    },
    update: {
      available: parsed.available,
    },
    create: {
      variantId: variant.id,
      locationId: location.id,
      available: parsed.available,
    },
  });

  const aggregatedQuantity = await prisma.variantInventory.aggregate({
    where: { variantId: variant.id },
    _sum: { available: true },
  });

  const currentQuantity = aggregatedQuantity._sum.available ?? parsed.available;
  await prisma.variant.update({
    where: { id: variant.id },
    data: {
      inventoryQuantity: currentQuantity,
      lastInventorySyncAt: new Date(),
    },
  });

  await monitorVariantQuantity({
    merchantId: merchant.id,
    settings: variant.merchant.settings,
    product: variant.product,
    variant,
    location,
    currentQuantity: parsed.available,
  });

  return new Response("ok", { status: 200 });
};

