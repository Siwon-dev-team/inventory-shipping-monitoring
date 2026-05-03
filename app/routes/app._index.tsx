import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { MetricEventType } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { recomputeMerchantForecasts } from "../services/inventory/forecast.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { getMerchantKpiSummary, recordMetricEvent } from "../services/metrics.server";
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

  return {
    merchant,
    settings,
    metrics: {
      activeAlerts,
      resolvedAlerts,
    },
    recentAlerts,
    kpis,
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
      </s-section>

      <s-section heading="Recent alerts">
        {data.recentAlerts.length === 0 ? (
          <s-paragraph>No alerts yet.</s-paragraph>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Level</th>
                <th>Product</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Location</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.recentAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{alert.alertLevel}</td>
                  <td>{alert.product.title}</td>
                  <td>{alert.variant.sku || "No SKU"}</td>
                  <td>{alert.currentQuantity}</td>
                  <td>{alert.alertStatus}</td>
                  <td>{alert.location?.name ?? "-"}</td>
                  <td>{new Date(alert.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
