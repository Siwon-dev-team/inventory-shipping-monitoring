type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type InventoryAdjustResponse = {
  data?: {
    inventoryAdjustQuantities?: {
      userErrors?: Array<{ message: string }>;
    };
  };
};

const INVENTORY_ADJUST_MUTATION = `#graphql
  mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function adjustShopifyInventory(params: {
  admin: AdminGraphqlClient;
  inventoryItemGid: string;
  locationGid: string;
  delta: number;
  reason?: string;
}) {
  const response = await params.admin.graphql(INVENTORY_ADJUST_MUTATION, {
    variables: {
      input: {
        reason: params.reason ?? "correction",
        name: "purchase-order-receive",
        changes: [
          {
            inventoryItemId: params.inventoryItemGid,
            locationId: params.locationGid,
            delta: params.delta,
          },
        ],
      },
    },
  });

  const payload = (await response.json()) as InventoryAdjustResponse;
  const userErrors = payload.data?.inventoryAdjustQuantities?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join("; "));
  }
}

export function toInventoryItemGid(shopifyInventoryItemId: string) {
  return shopifyInventoryItemId.startsWith("gid://")
    ? shopifyInventoryItemId
    : `gid://shopify/InventoryItem/${shopifyInventoryItemId}`;
}

export function toLocationGid(shopifyLocationId: string) {
  return shopifyLocationId.startsWith("gid://")
    ? shopifyLocationId
    : `gid://shopify/Location/${shopifyLocationId}`;
}
