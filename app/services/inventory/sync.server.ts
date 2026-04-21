import type { Settings } from "@prisma/client";
import prisma from "../../db.server";
import { normalizeShopifyId } from "../shopify-id.server";
import { monitorVariantQuantity } from "./monitor.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type InventorySyncResult = {
  productsSynced: number;
  variantsSynced: number;
  locationsSynced: number;
  inventoryRowsSynced: number;
};

type ProductNode = {
  id: string;
  title: string;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      inventoryQuantity: number | null;
      inventoryItem: {
        id: string;
        inventoryLevels: {
          nodes: Array<{
            location: { id: string; name: string };
            quantities: Array<{ name: string; quantity: number }>;
          }>;
        };
      } | null;
    }>;
  };
};

export async function syncInventoryFromShopify(params: {
  admin: AdminGraphqlClient;
  merchantId: number;
  settings: Settings;
}) {
  const stats: InventorySyncResult = {
    productsSynced: 0,
    variantsSynced: 0,
    locationsSynced: 0,
    inventoryRowsSynced: 0,
  };

  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await params.admin.graphql(
      `#graphql
      query InventorySyncProducts($cursor: String) {
        products(first: 25, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            variants(first: 100) {
              nodes {
                id
                sku
                inventoryQuantity
                inventoryItem {
                  id
                  inventoryLevels(first: 25) {
                    nodes {
                      location {
                        id
                        name
                      }
                      quantities(names: ["available"]) {
                        name
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { cursor } },
    );

    const json = (await response.json()) as {
      data?: {
        products?: {
          pageInfo?: { hasNextPage: boolean; endCursor: string | null };
          nodes?: ProductNode[];
        };
      };
    };

    const productNodes = json.data?.products?.nodes ?? [];
    for (const productNode of productNodes) {
      const product = await upsertProduct(params.merchantId, productNode);
      stats.productsSynced += 1;

      for (const variantNode of productNode.variants.nodes) {
        const variant = await upsertVariant(params.merchantId, product.id, variantNode);
        stats.variantsSynced += 1;

        const levels = variantNode.inventoryItem?.inventoryLevels.nodes ?? [];
        for (const level of levels) {
          const location = await prisma.location.upsert({
            where: {
              merchantId_shopifyLocationId: {
                merchantId: params.merchantId,
                shopifyLocationId:
                  normalizeShopifyId(level.location.id) ?? level.location.id,
              },
            },
            update: {
              name: level.location.name,
            },
            create: {
              merchantId: params.merchantId,
              shopifyLocationId:
                normalizeShopifyId(level.location.id) ?? level.location.id,
              name: level.location.name,
            },
          });
          stats.locationsSynced += 1;

          const available =
            level.quantities.find((entry) => entry.name === "available")?.quantity ?? 0;

          await prisma.variantInventory.upsert({
            where: {
              variantId_locationId: {
                variantId: variant.id,
                locationId: location.id,
              },
            },
            update: {
              available,
            },
            create: {
              variantId: variant.id,
              locationId: location.id,
              available,
            },
          });
          stats.inventoryRowsSynced += 1;

          await monitorVariantQuantity({
            merchantId: params.merchantId,
            settings: params.settings,
            product,
            variant,
            location,
            currentQuantity: available,
          });
        }
      }
    }

    hasNextPage = json.data?.products?.pageInfo?.hasNextPage ?? false;
    cursor = json.data?.products?.pageInfo?.endCursor ?? null;
  }

  return stats;
}

async function upsertProduct(merchantId: number, node: ProductNode) {
  const shopifyProductId = normalizeShopifyId(node.id) ?? node.id;
  return prisma.product.upsert({
    where: {
      merchantId_shopifyProductId: {
        merchantId,
        shopifyProductId,
      },
    },
    update: {
      title: node.title,
    },
    create: {
      merchantId,
      shopifyProductId,
      title: node.title,
    },
  });
}

async function upsertVariant(
  merchantId: number,
  productId: number,
  node: ProductNode["variants"]["nodes"][number],
) {
  const shopifyVariantId = normalizeShopifyId(node.id) ?? node.id;
  const shopifyInventoryItemId = normalizeShopifyId(node.inventoryItem?.id);

  return prisma.variant.upsert({
    where: {
      merchantId_shopifyVariantId: {
        merchantId,
        shopifyVariantId,
      },
    },
    update: {
      productId,
      sku: node.sku ?? null,
      inventoryQuantity: node.inventoryQuantity ?? 0,
      shopifyInventoryItemId,
      lastInventorySyncAt: new Date(),
    },
    create: {
      merchantId,
      productId,
      shopifyVariantId,
      sku: node.sku ?? null,
      inventoryQuantity: node.inventoryQuantity ?? 0,
      shopifyInventoryItemId,
      lastInventorySyncAt: new Date(),
    },
  });
}

