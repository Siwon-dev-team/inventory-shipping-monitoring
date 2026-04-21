import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { normalizeShopifyId } from "../services/shopify-id.server";
import { markWebhookProcessed } from "../services/webhook-idempotency.server";

type ProductVariantPayload = {
  id?: number;
  sku?: string | null;
  inventory_quantity?: number;
  inventory_item_id?: number;
};

type ProductsUpdateWebhookPayload = {
  id?: number;
  title?: string;
  variants?: ProductVariantPayload[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const { topic, shop, payload } = await authenticate.webhook(request);
  if (topic !== "PRODUCTS_UPDATE") {
    return new Response("Unhandled topic", { status: 200 });
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

  const productPayload = payload as ProductsUpdateWebhookPayload;
  if (!productPayload.id) {
    return new Response("Missing product id", { status: 200 });
  }

  const product = await prisma.product.upsert({
    where: {
      merchantId_shopifyProductId: {
        merchantId: merchant.id,
        shopifyProductId:
          normalizeShopifyId(productPayload.id) ?? String(productPayload.id),
      },
    },
    update: {
      title: productPayload.title ?? "Untitled product",
    },
    create: {
      merchantId: merchant.id,
      shopifyProductId:
        normalizeShopifyId(productPayload.id) ?? String(productPayload.id),
      title: productPayload.title ?? "Untitled product",
    },
  });

  for (const variantPayload of productPayload.variants ?? []) {
    if (!variantPayload.id) continue;

    await prisma.variant.upsert({
      where: {
        merchantId_shopifyVariantId: {
          merchantId: merchant.id,
          shopifyVariantId:
            normalizeShopifyId(variantPayload.id) ?? String(variantPayload.id),
        },
      },
      update: {
        sku: variantPayload.sku ?? null,
        inventoryQuantity: variantPayload.inventory_quantity ?? 0,
        shopifyInventoryItemId: variantPayload.inventory_item_id
          ? normalizeShopifyId(variantPayload.inventory_item_id)
          : null,
      },
      create: {
        merchantId: merchant.id,
        productId: product.id,
        shopifyVariantId:
          normalizeShopifyId(variantPayload.id) ?? String(variantPayload.id),
        sku: variantPayload.sku ?? null,
        inventoryQuantity: variantPayload.inventory_quantity ?? 0,
        shopifyInventoryItemId: variantPayload.inventory_item_id
          ? normalizeShopifyId(variantPayload.inventory_item_id)
          : null,
      },
    });
  }

  return new Response("ok", { status: 200 });
};

