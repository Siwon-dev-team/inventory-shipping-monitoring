import { AlertStatus } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  computeDaysOfCover,
  computeUrgencyScore,
} from "../services/inventory/inventory-metrics.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

type AlertRow = {
  id: number;
  alertLevel: string;
  alertStatus: AlertStatus;
  productTitle: string;
  sku: string | null;
  currentQuantity: number;
  thresholdValue: number;
  locationName: string | null;
  createdAt: Date;
  urgencyScore: number;
  daysOfCover: number | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const url = new URL(request.url);
  const locationIdParam = url.searchParams.get("locationId");
  const locationId = locationIdParam ? Number(locationIdParam) : null;
  const statusFilter = url.searchParams.get("status") ?? "all";

  const locations = await prisma.location.findMany({
    where: { merchantId: merchant.id },
    orderBy: { name: "asc" },
  });

  const alerts = await prisma.inventoryAlert.findMany({
    where: {
      merchantId: merchant.id,
      ...(Number.isFinite(locationId) ? { locationId } : {}),
      ...(statusFilter === "active"
        ? { alertStatus: AlertStatus.ACTIVE }
        : statusFilter === "resolved"
          ? { alertStatus: AlertStatus.RESOLVED }
          : {}),
    },
    include: {
      product: true,
      variant: true,
      location: true,
    },
    take: 100,
  });

  const rows: AlertRow[] = alerts.map((alert) => {
    const forecastDaily = alert.variant.forecastDaily ?? 0;
    const daysOfCover = computeDaysOfCover(alert.currentQuantity, forecastDaily);
    const urgencyScore = computeUrgencyScore({
      daysOfCover,
      alertLevel: alert.alertLevel,
      classification: alert.product.classification,
      reorderSuggestionQty: alert.variant.reorderSuggestionQty ?? 0,
    });

    return {
      id: alert.id,
      alertLevel: alert.alertLevel,
      alertStatus: alert.alertStatus,
      productTitle: alert.product.title,
      sku: alert.variant.sku,
      currentQuantity: alert.currentQuantity,
      thresholdValue: alert.thresholdValue,
      locationName: alert.location?.name ?? null,
      createdAt: alert.createdAt,
      urgencyScore,
      daysOfCover,
    };
  });

  rows.sort((a, b) => {
    if (a.alertStatus !== b.alertStatus) {
      return a.alertStatus === AlertStatus.ACTIVE ? -1 : 1;
    }
    return b.urgencyScore - a.urgencyScore;
  });

  return {
    rows: rows.slice(0, 50),
    locations,
    locationId: Number.isFinite(locationId) ? locationId : null,
    statusFilter,
  };
};

function getAlertBadge(level: string) {
  if (level === "OUT_OF_STOCK" || level === "CRITICAL") {
    return <Badge tone="critical">{level}</Badge>;
  }
  if (level === "LOW") {
    return <Badge tone="warning">{level}</Badge>;
  }
  return <Badge>{level}</Badge>;
}

export default function AlertsPage() {
  const { rows, locations, locationId, statusFilter } = useLoaderData<typeof loader>();
  const active = rows.filter((item) => item.alertStatus === AlertStatus.ACTIVE);
  const resolved = rows.filter((item) => item.alertStatus === AlertStatus.RESOLVED);

  return (
    <s-page heading="Inventory Alerts">
      <s-section heading="Summary">
        <s-paragraph>
          Active: <s-text>{active.length}</s-text>
        </s-paragraph>
        <s-paragraph>
          Resolved: <s-text>{resolved.length}</s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Filters">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <label>
              Location
              <select name="locationId" defaultValue={locationId ?? ""}>
                <option value="">All locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={statusFilter}>
                <option value="all">All</option>
                <option value="active">Active only</option>
                <option value="resolved">Resolved only</option>
              </select>
            </label>
            <s-button type="submit">Apply</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Alerts ranked by urgency">
        {rows.length === 0 ? (
          <s-paragraph>No alerts yet.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "alert", plural: "alerts" }}
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "Urgency" },
                { title: "Level" },
                { title: "Product" },
                { title: "SKU" },
                { title: "Qty" },
                { title: "Days cover" },
                { title: "Threshold" },
                { title: "Status" },
                { title: "Location" },
                { title: "Created" },
              ]}
            >
              {rows.map((alert, index) => (
                <IndexTable.Row id={`alert-${alert.id}`} key={alert.id} position={index}>
                  <IndexTable.Cell>{alert.urgencyScore}</IndexTable.Cell>
                  <IndexTable.Cell>{getAlertBadge(alert.alertLevel)}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.productTitle}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.sku || "No SKU"}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.currentQuantity}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {alert.daysOfCover != null ? alert.daysOfCover.toFixed(1) : "-"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{alert.thresholdValue}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.alertStatus}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.locationName ?? "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(alert.createdAt).toLocaleString()}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
        <s-paragraph>Showing latest 50 alerts sorted by urgency.</s-paragraph>
      </s-section>
    </s-page>
  );
}
