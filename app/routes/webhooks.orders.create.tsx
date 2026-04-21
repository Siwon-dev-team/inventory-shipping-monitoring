import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { recomputeMerchantForecasts } from "../services/inventory/forecast.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { normalizeShopifyId } from "../services/shopify-id.server";
import { markWebhookProcessed } from "../services/webhook-idempotency.server";

type OrderLineItemPayload = {
  variant_id?: number;
  quantity?: number;
};

type OrdersCreateWebhookPayload = {
  id?: number;
  created_at?: string;
  line_items?: OrderLineItemPayload[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const { topic, shop, payload } = await authenticate.webhook(request);
  if (topic !== "ORDERS_CREATE") {
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

  const orderPayload = payload as OrdersCreateWebhookPayload;
  const createdAt = orderPayload.created_at ? new Date(orderPayload.created_at) : new Date();

  for (const lineItem of orderPayload.line_items ?? []) {
    if (!lineItem.variant_id || !lineItem.quantity || lineItem.quantity <= 0) continue;

    const variant = await prisma.variant.findFirst({
      where: {
        merchantId: merchant.id,
        shopifyVariantId:
          normalizeShopifyId(lineItem.variant_id) ?? String(lineItem.variant_id),
      },
    });
    if (!variant) continue;

    const sourceOrderId = orderPayload.id
      ? normalizeShopifyId(orderPayload.id) ?? String(orderPayload.id)
      : null;

    if (sourceOrderId) {
      await prisma.salesData.upsert({
        where: {
          variantId_sourceOrderId: {
            variantId: variant.id,
            sourceOrderId,
          },
        },
        update: {
          quantitySold: lineItem.quantity,
          date: createdAt,
        },
        create: {
          merchantId: merchant.id,
          variantId: variant.id,
          sourceOrderId,
          date: createdAt,
          quantitySold: lineItem.quantity,
        },
      });
    } else {
      await prisma.salesData.create({
        data: {
          merchantId: merchant.id,
          variantId: variant.id,
          sourceOrderId: null,
          date: createdAt,
          quantitySold: lineItem.quantity,
        },
      });
    }
  }

  await recomputeMerchantForecasts(merchant.id);

  return new Response("ok", { status: 200 });
};

