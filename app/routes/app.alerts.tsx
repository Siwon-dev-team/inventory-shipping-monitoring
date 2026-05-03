import { AlertStatus } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
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
    take: 100,
  });

  return { alerts };
};

function getAlertBadge(level: string) {
  if (level === "OUT_OF_STOCK" || level === "CRITICAL") {
    return <span style={{ background: "#fecaca", color: "#7f1d1d", padding: "2px 8px", borderRadius: "999px", fontWeight: 600 }}>{level}</span>;
  }
  if (level === "LOW") {
    return <span style={{ background: "#fef3c7", color: "#78350f", padding: "2px 8px", borderRadius: "999px", fontWeight: 600 }}>{level}</span>;
  }
  return <span>{level}</span>;
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
          <table>
            <thead>
              <tr>
                <th>Level</th>
                <th>Product</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Threshold</th>
                <th>Status</th>
                <th>Location</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{getAlertBadge(alert.alertLevel)}</td>
                  <td>{alert.product.title}</td>
                  <td>{alert.variant.sku || "No SKU"}</td>
                  <td>{alert.currentQuantity}</td>
                  <td>{alert.thresholdValue}</td>
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

