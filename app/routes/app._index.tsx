import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { MetricEventType } from "@prisma/client";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { recomputeMerchantForecasts } from "../services/inventory/forecast.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { getMerchantKpiSummary, recordMetricEvent } from "../services/metrics.server";
import { buildReorderList } from "../services/inventory/reorder-list.server";
import { getLatestInventoryInsights } from "../services/ai/insights.server";
import { syncInventoryFromShopify } from "../services/inventory/sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const settings = await prisma.settings.findUnique({
    where: { merchantId: merchant.id },
  });

  const activeAlerts = await prisma.inventoryAlert.count({
    where: { merchantId: merchant.id, alertStatus: "ACTIVE" },
  });

  const resolvedAlerts = await prisma.inventoryAlert.count({
    where: { merchantId: merchant.id, alertStatus: "RESOLVED" },
  });
  const recentAlerts = await prisma.inventoryAlert.findMany({
    where: { merchantId: merchant.id },
    include: { product: true, variant: true, location: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const kpis = await getMerchantKpiSummary(merchant.id);
  const reorder = await buildReorderList({
    merchantId: merchant.id,
    needsReorderOnly: true,
  });
  const variantCount = await prisma.variant.count({
    where: { merchantId: merchant.id },
  });
  const aiInsights =
    settings?.aiEnabled !== false
      ? await getLatestInventoryInsights(merchant.id, 3)
      : [];

  return {
    merchant,
    settings,
    metrics: {
      activeAlerts,
      resolvedAlerts,
    },
    recentAlerts,
    kpis,
    reorderSummary: reorder.summary,
    topReorderRows: reorder.rows.slice(0, 5),
    onboarding: {
      monitoringEnabled: settings?.monitoringEnabled ?? false,
      hasInventoryData: variantCount > 0,
      hasActiveAlertsViewed: activeAlerts > 0 || (settings?.onboardingCompleted ?? false),
    },
    aiInsights,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "save_settings");

  if (actionType === "sync_inventory") {
    const settings = await prisma.settings.findUnique({
      where: { merchantId: merchant.id },
    });
    if (!settings) {
      return { ok: false as const, message: "Missing settings" };
    }

    const stats = await syncInventoryFromShopify({
      admin,
      merchantId: merchant.id,
      settings,
    });
    const forecastStats = await recomputeMerchantForecasts(merchant.id);

    return { ok: true as const, synced: true as const, stats, forecastStats };
  }

  if (actionType === "complete_onboarding") {
    await prisma.settings.updateMany({
      where: { merchantId: merchant.id },
      data: { onboardingCompleted: true },
    });
    return { ok: true as const, synced: false as const, onboardingCompleted: true as const };
  }

  const monitoringEnabled = formData.get("monitoringEnabled") === "on";
  const globalLowThreshold = Number(formData.get("globalLowThreshold"));
  const globalCriticalThreshold = Number(formData.get("globalCriticalThreshold"));
  const schedulerIntervalMinutes = Number(formData.get("schedulerIntervalMinutes"));

  const lowThreshold = Number.isFinite(globalLowThreshold)
    ? Math.max(1, Math.floor(globalLowThreshold))
    : 5;
  const criticalThreshold = Number.isFinite(globalCriticalThreshold)
    ? Math.max(0, Math.floor(globalCriticalThreshold))
    : Math.max(1, Math.floor(lowThreshold * 0.5));
  const intervalMinutes = Number.isFinite(schedulerIntervalMinutes)
    ? Math.min(60, Math.max(5, Math.floor(schedulerIntervalMinutes)))
    : 15;

  await prisma.settings.upsert({
    where: { merchantId: merchant.id },
    update: {
      monitoringEnabled,
      globalLowThreshold: lowThreshold,
      globalCriticalThreshold: criticalThreshold,
      schedulerIntervalMinutes: intervalMinutes,
    },
    create: {
      merchantId: merchant.id,
      monitoringEnabled,
      globalLowThreshold: lowThreshold,
      globalCriticalThreshold: criticalThreshold,
      schedulerIntervalMinutes: intervalMinutes,
    },
  });

  if (monitoringEnabled) {
    await recordMetricEvent({
      merchantId: merchant.id,
      eventType: MetricEventType.MONITORING_ENABLED,
    });
  }

  return { ok: true as const, synced: false as const };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const settings = data.settings;
  const lowThreshold = settings?.globalLowThreshold ?? 5;
  const criticalThreshold =
    settings?.globalCriticalThreshold ?? Math.max(1, Math.floor(lowThreshold * 0.5));
  const interval = settings?.schedulerIntervalMinutes ?? 15;

  return (
    <s-page heading="Inventory Monitoring Dashboard">
      {!settings?.onboardingCompleted ? (
        <s-section heading="Quick setup">
          <s-paragraph>
            {data.onboarding.monitoringEnabled ? "✓" : "○"} 1. Enable monitoring and save
            thresholds below.
          </s-paragraph>
          <s-paragraph>
            {data.onboarding.hasInventoryData ? "✓" : "○"} 2. Sync inventory from Shopify.
          </s-paragraph>
          <s-paragraph>
            {data.onboarding.hasActiveAlertsViewed ? "✓" : "○"} 3. Review alerts and reorder
            list.
          </s-paragraph>
          <Form method="post">
            <input type="hidden" name="actionType" value="complete_onboarding" />
            <s-button
              type="submit"
              variant="primary"
              disabled={
                !data.onboarding.monitoringEnabled || !data.onboarding.hasInventoryData
              }
            >
              Mark setup complete
            </s-button>
          </Form>
        </s-section>
      ) : null}

      <s-section heading="Inventory health">
        <s-paragraph>
          Stock health score: <s-text>{data.reorderSummary.stockHealthScore}%</s-text>
        </s-paragraph>
        <s-paragraph>
          SKUs needing reorder: <s-text>{data.reorderSummary.needsReorder}</s-text>
        </s-paragraph>
        <s-paragraph>
          Dead stock SKUs: <s-text>{data.reorderSummary.deadStockCount}</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/reorder">Open reorder list</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/purchase-orders">Create purchase orders</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/analytics">View ABC analytics</s-link>
        </s-paragraph>
      </s-section>

      <s-section heading="AI insights">
        {data.aiInsights.length === 0 ? (
          <s-paragraph>
            <s-link href="/app/ai">Open AI insights</s-link> to generate recommendations.
          </s-paragraph>
        ) : (
          data.aiInsights.map((insight) => (
            <s-paragraph key={insight.id}>
              <s-text>
                {insight.title}: {insight.message}
              </s-text>
            </s-paragraph>
          ))
        )}
        <s-paragraph>
          <s-link href="/app/ai">View all AI insights</s-link>
        </s-paragraph>
      </s-section>

      <s-section heading="Monitoring settings">
        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-checkbox
              name="monitoringEnabled"
              checked={settings?.monitoringEnabled ?? true}
              label="Enable monitoring"
            />
            <s-text-field
              name="globalLowThreshold"
              label="Global low threshold"
              value={String(lowThreshold)}
            />
            <s-text-field
              name="globalCriticalThreshold"
              label="Global critical threshold"
              value={String(criticalThreshold)}
            />
            <s-text-field
              name="schedulerIntervalMinutes"
              label="Scheduler interval (minutes)"
              value={String(interval)}
            />
            <s-button type="submit" variant="primary">
              Save settings
            </s-button>
            <input type="hidden" name="actionType" value="save_settings" />
          </s-stack>
        </Form>
        {actionData?.ok ? (
          <s-paragraph>
            <s-text>
              {actionData.synced
                ? "Inventory synced from Shopify."
                : "Settings saved."}
            </s-text>
          </s-paragraph>
        ) : null}
        {actionData?.synced ? (
          <s-paragraph>
            <s-text>
              Synced products: {actionData.stats.productsSynced}, variants:{" "}
              {actionData.stats.variantsSynced}, inventory rows:{" "}
              {actionData.stats.inventoryRowsSynced}
            </s-text>
          </s-paragraph>
        ) : null}
        {actionData?.synced ? (
          <s-paragraph>
            <s-text>
              Forecast recalculated for variants:{" "}
              {actionData.forecastStats.variantsUpdated}
            </s-text>
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Current status">
        <s-paragraph>
          Shop: <s-text>{data.merchant.shopDomain}</s-text>
        </s-paragraph>
        <s-paragraph>
          Monitoring:{" "}
          <s-text>{settings?.monitoringEnabled ? "Enabled" : "Disabled"}</s-text>
        </s-paragraph>
        <s-paragraph>
          Active alerts: <s-text>{data.metrics.activeAlerts}</s-text>
        </s-paragraph>
        <s-paragraph>
          Resolved alerts: <s-text>{data.metrics.resolvedAlerts}</s-text>
        </s-paragraph>
        <s-paragraph>
          Monitoring activations:{" "}
          <s-text>{data.kpis.monitoringEnabledCount}</s-text>
        </s-paragraph>
        <s-paragraph>
          Alerts logged: <s-text>{data.kpis.alertCreatedCount}</s-text>
        </s-paragraph>
        <s-paragraph>
          Avg alert-to-restock (hours):{" "}
          <s-text>
            {data.kpis.averageAlertToRestockHours
              ? data.kpis.averageAlertToRestockHours.toFixed(2)
              : "N/A"}
          </s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Quick actions">
        <Form method="post">
          <input type="hidden" name="actionType" value="sync_inventory" />
          <s-button type="submit">Sync inventory now</s-button>
        </Form>
        <s-paragraph>
          <s-link href="/app/alerts">Open alerts</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/thresholds">Configure thresholds</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/notifications">Configure notifications</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/forecasting">Forecast and reorder</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/suppliers">Manage suppliers</s-link>
        </s-paragraph>
      </s-section>

      <s-section heading="Top reorder priorities">
        {data.topReorderRows.length === 0 ? (
          <s-paragraph>No urgent SKUs right now.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "SKU", plural: "SKUs" }}
              itemCount={data.topReorderRows.length}
              selectable={false}
              headings={[
                { title: "Urgency" },
                { title: "Product" },
                { title: "Location" },
                { title: "Reorder qty" },
              ]}
            >
              {data.topReorderRows.map((row, index) => (
                <IndexTable.Row
                  id={`top-reorder-${row.variantId}-${row.locationId ?? "default"}`}
                  key={`${row.variantId}-${row.locationId ?? "default"}`}
                  position={index}
                >
                  <IndexTable.Cell>{row.urgencyScore}</IndexTable.Cell>
                  <IndexTable.Cell>{row.productTitle}</IndexTable.Cell>
                  <IndexTable.Cell>{row.locationName || "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{row.reorderSuggestionQty}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>

      <s-section heading="Recent alerts">
        {data.recentAlerts.length === 0 ? (
          <s-paragraph>No alerts yet.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "alert", plural: "alerts" }}
              itemCount={data.recentAlerts.length}
              selectable={false}
              headings={[
                { title: "Level" },
                { title: "Product" },
                { title: "SKU" },
                { title: "Qty" },
                { title: "Status" },
                { title: "Location" },
                { title: "Created" },
              ]}
            >
              {data.recentAlerts.map((alert, index) => (
                <IndexTable.Row id={`dashboard-alert-${alert.id}`} key={alert.id} position={index}>
                  <IndexTable.Cell>
                    {alert.alertLevel === "OUT_OF_STOCK" || alert.alertLevel === "CRITICAL" ? (
                      <Badge tone="critical">{alert.alertLevel}</Badge>
                    ) : alert.alertLevel === "LOW" ? (
                      <Badge tone="warning">{alert.alertLevel}</Badge>
                    ) : (
                      <Badge>{alert.alertLevel}</Badge>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{alert.product.title}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.variant.sku || "No SKU"}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.currentQuantity}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.alertStatus}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.location?.name ?? "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(alert.createdAt).toLocaleString()}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
