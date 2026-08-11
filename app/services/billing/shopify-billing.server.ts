import { PRO_PRICE, PRO_PRICE_CURRENCY, upgradeToPro, downgradeToFree } from "./subscription.server";

type AdminApiContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const CREATE_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      test: true
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_ACTIVE_SUBSCRIPTIONS_QUERY = `
  query GetActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

type CreateSubscriptionResult = {
  appSubscriptionCreate: {
    appSubscription: { id: string; status: string } | null;
    confirmationUrl: string | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
};

type ActiveSubscriptionsResult = {
  currentAppInstallation: {
    activeSubscriptions: Array<{
      id: string;
      name: string;
      status: string;
      currentPeriodEnd: string;
    }>;
  };
};

export async function createProSubscription(
  admin: AdminApiContext,
  returnUrl: string,
): Promise<{ confirmationUrl: string | null; error: string | null }> {
  const response = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
    variables: {
      name: "Pro Plan",
      returnUrl,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: PRO_PRICE, currencyCode: PRO_PRICE_CURRENCY },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  });

  const result = (await response.json()) as { data: CreateSubscriptionResult };

  if (result.data.appSubscriptionCreate.userErrors.length > 0) {
    return {
      confirmationUrl: null,
      error: result.data.appSubscriptionCreate.userErrors[0].message,
    };
  }

  return {
    confirmationUrl: result.data.appSubscriptionCreate.confirmationUrl,
    error: null,
  };
}

export async function getActiveSubscription(admin: AdminApiContext) {
  const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTIONS_QUERY);
  const result = (await response.json()) as { data: ActiveSubscriptionsResult };

  const subscriptions = result.data.currentAppInstallation.activeSubscriptions;
  const proSubscription = subscriptions.find((sub) => sub.name === "Pro Plan");

  return proSubscription ?? null;
}

export async function cancelProSubscription(
  admin: AdminApiContext,
  subscriptionId: string,
): Promise<{ success: boolean; error: string | null }> {
  const response = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
    variables: { id: subscriptionId },
  });

  const result = (await response.json()) as {
    data: {
      appSubscriptionCancel: {
        appSubscription: { id: string; status: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    };
  };

  if (result.data.appSubscriptionCancel.userErrors.length > 0) {
    return {
      success: false,
      error: result.data.appSubscriptionCancel.userErrors[0].message,
    };
  }

  return { success: true, error: null };
}

export async function handleBillingCallback(
  merchantId: number,
  admin: AdminApiContext,
  chargeId: string | null,
): Promise<{ success: boolean; plan: "FREE" | "PRO" }> {
  if (!chargeId) {
    return { success: false, plan: "FREE" };
  }

  const activeSubscription = await getActiveSubscription(admin);

  if (activeSubscription && activeSubscription.status === "ACTIVE") {
    await upgradeToPro(merchantId, activeSubscription.id);
    return { success: true, plan: "PRO" };
  }

  await downgradeToFree(merchantId);
  return { success: false, plan: "FREE" };
}
