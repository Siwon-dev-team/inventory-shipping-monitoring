import { AlertStatus } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const alerts = await prisma.inventoryAlert.findMany({
    where: { merchantId: merchant.id },
    include: {
      product: true,
      variant: true,
      location: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return { alerts };
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
  const { alerts } = useLoaderData<typeof loader>();
  const active = alerts.filter((item) => item.alertStatus === AlertStatus.ACTIVE);
  const resolved = alerts.filter((item) => item.alertStatus === AlertStatus.RESOLVED);

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

      <s-section heading="Recent alerts">
        {alerts.length === 0 ? (
          <s-paragraph>No alerts yet.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "alert", plural: "alerts" }}
              itemCount={alerts.length}
              selectable={false}
              headings={[
                { title: "Level" },
                { title: "Product" },
                { title: "SKU" },
                { title: "Qty" },
                { title: "Threshold" },
                { title: "Status" },
                { title: "Location" },
                { title: "Created" },
              ]}
            >
              {alerts.map((alert, index) => (
                <IndexTable.Row id={`alert-${alert.id}`} key={alert.id} position={index}>
                  <IndexTable.Cell>{getAlertBadge(alert.alertLevel)}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.product.title}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.variant.sku || "No SKU"}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.currentQuantity}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.thresholdValue}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.alertStatus}</IndexTable.Cell>
                  <IndexTable.Cell>{alert.location?.name ?? "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(alert.createdAt).toLocaleString()}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
        <s-paragraph>Showing latest 50 alerts.</s-paragraph>
      </s-section>
    </s-page>
  );
}

