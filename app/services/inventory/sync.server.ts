import type { Settings } from "@prisma/client";
import prisma from "../../db.server";
import { normalizeShopifyId } from "../shopify-id.server";
import { withRetry } from "../retry.server";
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
};

type InventoryLevelNode = {
  location: { id: string; name: string };
  quantities: Array<{ name: string; quantity: number }>;
};

type VariantNode = {
  id: string;
  sku: string | null;
  inventoryQuantity: number | null;
  inventoryItem: {
    id: string;
  } | null;
};

const PRODUCTS_PAGE_SIZE = Math.min(
  10,
  Math.max(1, Number(process.env.SYNC_PRODUCTS_PAGE_SIZE ?? "5")),
);
const VARIANTS_PAGE_SIZE = Math.min(
  20,
  Math.max(1, Number(process.env.SYNC_VARIANTS_PAGE_SIZE ?? "10")),
);
const INVENTORY_LEVELS_PAGE_SIZE = Math.min(
  20,
  Math.max(1, Number(process.env.SYNC_INVENTORY_LEVELS_PAGE_SIZE ?? "10")),
);

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
    const productPage = await fetchProductsPage(
      params.admin,
      cursor,
      PRODUCTS_PAGE_SIZE,
    );
    const productNodes = productPage.nodes;
    for (const productNode of productNodes) {
      const product = await upsertProduct(params.merchantId, productNode);
      stats.productsSynced += 1;

      const variants = await fetchVariantsForProduct(
        params.admin,
        productNode.id,
        VARIANTS_PAGE_SIZE,
      );
      for (const variantNode of variants) {
        const variant = await upsertVariant(params.merchantId, product.id, variantNode);
        stats.variantsSynced += 1;

        const levels = variantNode.inventoryItem?.id
          ? await fetchInventoryLevelsForItem(params.admin, variantNode.inventoryItem.id)
          : [];
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

    hasNextPage = productPage.pageInfo.hasNextPage;
    cursor = productPage.pageInfo.endCursor;
  }

  return stats;
}

async function fetchProductsPage(
  admin: AdminGraphqlClient,
  cursor: string | null,
  pageSize: number,
) {
  const response = await withRetry(
    () =>
      admin.graphql(
        `#graphql
        query InventorySyncProducts($cursor: String, $productsFirst: Int!) {
          products(first: $productsFirst, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              title
            }
          }
        }`,
        {
          variables: {
            cursor,
            productsFirst: pageSize,
          },
        },
      ),
    3,
    300,
  );

  const json = (await response.json()) as {
    data?: {
      products?: {
        pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        nodes?: ProductNode[];
      };
    };
  };

  return {
    pageInfo: {
      hasNextPage: json.data?.products?.pageInfo?.hasNextPage ?? false,
      endCursor: json.data?.products?.pageInfo?.endCursor ?? null,
    },
    nodes: json.data?.products?.nodes ?? [],
  };
}

async function fetchVariantsForProduct(
  admin: AdminGraphqlClient,
  productId: string,
  pageSize: number,
): Promise<VariantNode[]> {
  const variants: VariantNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await withRetry(
      () =>
        admin.graphql(
          `#graphql
          query ProductVariantsPage($id: ID!, $cursor: String, $variantsFirst: Int!) {
            product(id: $id) {
              variants(first: $variantsFirst, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  id
                  sku
                  inventoryQuantity
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }`,
          {
            variables: {
              id: productId,
              cursor,
              variantsFirst: pageSize,
            },
          },
        ),
      3,
      300,
    );

    const json = (await response.json()) as {
      data?: {
        product?: {
          variants?: {
            pageInfo?: { hasNextPage: boolean; endCursor: string | null };
            nodes?: VariantNode[];
          };
        };
      };
    };

    const page = json.data?.product?.variants;
    variants.push(...(page?.nodes ?? []));
    hasNextPage = page?.pageInfo?.hasNextPage ?? false;
    cursor = page?.pageInfo?.endCursor ?? null;
  }

  return variants;
}

async function fetchInventoryLevelsForItem(
  admin: AdminGraphqlClient,
  inventoryItemId: string,
): Promise<InventoryLevelNode[]> {
  const response = await withRetry(
    () =>
      admin.graphql(
        `#graphql
        query InventoryItemLevels($id: ID!, $levelsFirst: Int!) {
          inventoryItem(id: $id) {
            inventoryLevels(first: $levelsFirst) {
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
        }`,
        {
          variables: {
            id: inventoryItemId,
            levelsFirst: INVENTORY_LEVELS_PAGE_SIZE,
          },
        },
      ),
    3,
    300,
  );

  const json = (await response.json()) as {
    data?: {
      inventoryItem?: {
        inventoryLevels?: {
          nodes?: InventoryLevelNode[];
        };
      };
    };
  };

  return json.data?.inventoryItem?.inventoryLevels?.nodes ?? [];
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
  node: VariantNode,
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

