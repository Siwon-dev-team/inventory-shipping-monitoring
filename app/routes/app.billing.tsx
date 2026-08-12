import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation, redirect } from "react-router";
import { Badge, Card, IndexTable, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import {
  getOrCreateSubscription,
  getPlanLimits,
  PRO_PRICE,
  downgradeToFree,
} from "../services/billing/subscription.server";
import {
  createProSubscription,
  getActiveSubscription,
  cancelProSubscription,
  handleBillingCallback,
} from "../services/billing/shopify-billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const subscription = await getOrCreateSubscription(merchant.id);
  const planLimits = getPlanLimits(subscription.plan);

  // Check for billing callback
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  if (chargeId) {
    const result = await handleBillingCallback(merchant.id, admin, chargeId);
    return redirect(`/app/billing?upgraded=${result.success}`);
  }

  const upgraded = url.searchParams.get("upgraded");
  const shopifySubscription = await getActiveSubscription(admin);

  return {
    subscription: {
      ...subscription,
      queryResetAt: subscription.queryResetAt.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    },
    planLimits,
    proPrice: PRO_PRICE,
    shopifySubscriptionActive: shopifySubscription?.status === "ACTIVE",
    shopifySubscriptionId: shopifySubscription?.id ?? null,
    upgraded: upgraded === "true",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "");

  if (actionType === "upgrade") {
    const returnUrl = `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing`;
    const result = await createProSubscription(admin, returnUrl);

    if (result.error) {
      return { ok: false, error: result.error };
    }

    if (result.confirmationUrl) {
      // Redirect to intermediate page that handles external redirect
      return redirect(`/app/billing-redirect?url=${encodeURIComponent(result.confirmationUrl)}`);
    }

    return { ok: false, error: "Failed to create subscription" };
  }

  if (actionType === "cancel") {
    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    if (!subscriptionId) {
      return { ok: false, error: "No subscription to cancel" };
    }

    const result = await cancelProSubscription(admin, subscriptionId);
    if (!result.success) {
      return { ok: false, error: result.error };
    }

    await downgradeToFree(merchant.id);
    return { ok: true, message: "Subscription cancelled" };
  }

  return { ok: false, error: "Invalid action" };
};

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const isPro = data.subscription.plan === "PRO";
  const usagePercent = Math.round(
    (data.subscription.dailyQueryCount / data.subscription.dailyQueryLimit) * 100
  );

  return (
    <s-page heading="Subscription & Billing">
      {data.upgraded && (
        <s-section>
          <Card>
            <div style={{ padding: "16px", background: "#d4edda", borderRadius: "8px" }}>
              <p style={{ margin: 0, color: "#155724", fontWeight: 500 }}>
                🎉 Successfully upgraded to Pro! You now have access to all premium features.
              </p>
            </div>
          </Card>
        </s-section>
      )}

      <s-section heading="Current Plan">
        <Card>
          <div style={{ padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <Badge tone={isPro ? "success" : "info"} size="large">
                {data.subscription.plan}
              </Badge>
              <span style={{ fontSize: "24px", fontWeight: 600 }}>
                {isPro ? `$${data.proPrice}/month` : "Free"}
              </span>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <p style={{ margin: "0 0 8px 0", fontWeight: 500 }}>AI Queries Today</p>
              <div style={{ 
                background: "#e0e0e0", 
                borderRadius: "8px", 
                height: "12px",
                overflow: "hidden" 
              }}>
                <div style={{
                  background: usagePercent > 80 ? "#d72c0d" : "#008060",
                  height: "100%",
                  width: `${Math.min(usagePercent, 100)}%`,
                  transition: "width 0.3s ease",
                }} />
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#637381" }}>
                {data.subscription.dailyQueryCount} / {data.subscription.dailyQueryLimit} queries used
                {" · "}Resets at midnight UTC
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <p style={{ margin: "0 0 8px 0", fontWeight: 500 }}>Features</p>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#202223" }}>
                {data.planLimits.features.map((feature) => (
                  <li key={feature} style={{ marginBottom: "4px" }}>
                    {formatFeatureName(feature)}
                  </li>
                ))}
              </ul>
            </div>

            {isPro && data.subscription.currentPeriodEnd && (
              <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#637381" }}>
                Current period ends: {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}

            {!isPro ? (
              <Form method="post">
                <input type="hidden" name="actionType" value="upgrade" />
                <Button variant="primary" submit loading={isSubmitting}>
                  {`Upgrade to Pro - $${data.proPrice}/month`}
                </Button>
              </Form>
            ) : (
              <Form method="post">
                <input type="hidden" name="actionType" value="cancel" />
                <input type="hidden" name="subscriptionId" value={data.shopifySubscriptionId ?? ""} />
                <Button variant="plain" tone="critical" submit loading={isSubmitting}>
                  Cancel Subscription
                </Button>
              </Form>
            )}
          </div>
        </Card>
      </s-section>

      <s-section heading="Plan Comparison">
        <Card>
          <IndexTable
            resourceName={{ singular: "feature", plural: "features" }}
            itemCount={7}
            selectable={false}
            headings={[
              { title: "Feature" },
              { title: "Free" },
              { title: `Pro ($${data.proPrice}/mo)` },
            ]}
          >
            <IndexTable.Row id="queries" position={0}>
              <IndexTable.Cell>Daily AI Queries</IndexTable.Cell>
              <IndexTable.Cell>20</IndexTable.Cell>
              <IndexTable.Cell>1,000</IndexTable.Cell>
            </IndexTable.Row>
            <IndexTable.Row id="history" position={1}>
              <IndexTable.Cell>Historical Data</IndexTable.Cell>
              <IndexTable.Cell>30 days</IndexTable.Cell>
              <IndexTable.Cell>12 months</IndexTable.Cell>
            </IndexTable.Row>
            <IndexTable.Row id="model" position={2}>
              <IndexTable.Cell>AI Model</IndexTable.Cell>
              <IndexTable.Cell>Llama 3 (Groq)</IndexTable.Cell>
              <IndexTable.Cell>GPT-4o</IndexTable.Cell>
            </IndexTable.Row>
            <IndexTable.Row id="forecasting" position={3}>
              <IndexTable.Cell>Forecasting</IndexTable.Cell>
              <IndexTable.Cell>Basic velocity</IndexTable.Cell>
              <IndexTable.Cell>ML + Seasonality</IndexTable.Cell>
            </IndexTable.Row>
            <IndexTable.Row id="replenishment" position={4}>
              <IndexTable.Cell>Auto-Replenishment</IndexTable.Cell>
              <IndexTable.Cell>❌</IndexTable.Cell>
              <IndexTable.Cell>✅</IndexTable.Cell>
            </IndexTable.Row>
            <IndexTable.Row id="reports" position={5}>
              <IndexTable.Cell>Weekly AI Reports</IndexTable.Cell>
              <IndexTable.Cell>❌</IndexTable.Cell>
              <IndexTable.Cell>✅</IndexTable.Cell>
            </IndexTable.Row>
            <IndexTable.Row id="scenarios" position={6}>
              <IndexTable.Cell>What-if Scenarios</IndexTable.Cell>
              <IndexTable.Cell>❌</IndexTable.Cell>
              <IndexTable.Cell>✅</IndexTable.Cell>
            </IndexTable.Row>
          </IndexTable>
        </Card>
      </s-section>
    </s-page>
  );
}

function formatFeatureName(feature: string): string {
  const names: Record<string, string> = {
    basic_qa: "Basic Q&A",
    basic_insights: "Basic Insights",
    advanced_qa: "Advanced Natural Language Q&A",
    function_calling: "AI Actions (create POs, send alerts)",
    auto_replenishment: "Auto-Replenishment Rules",
    weekly_reports: "Weekly AI Reports",
    ml_forecasting: "ML-based Forecasting",
    scenario_modeling: "What-if Scenario Modeling",
  };
  return names[feature] ?? feature;
}
