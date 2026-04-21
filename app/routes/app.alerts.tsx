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
          <s-stack direction="block" gap="base">
            {alerts.map((alert) => (
              <s-box key={alert.id} borderWidth="base" borderRadius="base" padding="base">
                <s-paragraph>
                  <s-text>{alert.alertLevel}</s-text> - {alert.product.title} ({alert.variant.sku || "No SKU"})
                </s-paragraph>
                <s-paragraph>
                  Qty: {alert.currentQuantity}, Threshold: {alert.thresholdValue}
                </s-paragraph>
                <s-paragraph>
                  Status: {alert.alertStatus}
                  {alert.location ? `, Location: ${alert.location.name}` : ""}
                </s-paragraph>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

