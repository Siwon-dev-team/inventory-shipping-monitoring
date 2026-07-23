import { PurchaseOrderStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  cancelPurchaseOrder,
  createPurchaseOrdersFromReorderRows,
  markPurchaseOrderReceived,
  sendPurchaseOrderEmail,
} from "../services/inventory/purchase-orders.server";
import { buildReorderList } from "../services/inventory/reorder-list.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

function poBadge(status: PurchaseOrderStatus) {
  if (status === PurchaseOrderStatus.RECEIVED) {
    return <Badge tone="success">{status}</Badge>;
  }
  if (status === PurchaseOrderStatus.SENT) {
    return <Badge tone="info">{status}</Badge>;
  }
  if (status === PurchaseOrderStatus.CANCELLED) {
    return <Badge>{status}</Badge>;
  }
  return <Badge tone="warning">{status}</Badge>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { merchantId: merchant.id },
    include: {
      supplier: true,
      lines: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return { purchaseOrders };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "");

  if (actionType === "create_from_reorder") {
    const { rows } = await buildReorderList({
      merchantId: merchant.id,
      needsReorderOnly: true,
    });
    const created = await createPurchaseOrdersFromReorderRows(merchant.id, rows);
    return {
      ok: true as const,
      message: `Created ${created.length} draft purchase order(s).`,
      createdCount: created.length,
    };
  }

  const purchaseOrderId = Number(formData.get("purchaseOrderId"));
  if (!Number.isFinite(purchaseOrderId)) {
    return { ok: false as const, message: "Invalid purchase order." };
  }

  try {
    if (actionType === "send") {
      await sendPurchaseOrderEmail(purchaseOrderId, merchant.id);
      return { ok: true as const, message: "Purchase order emailed to supplier." };
    }

    if (actionType === "receive") {
      await markPurchaseOrderReceived(purchaseOrderId, merchant.id, admin);
      return {
        ok: true as const,
        message: "Purchase order received and Shopify inventory updated.",
      };
    }

    if (actionType === "cancel") {
      await cancelPurchaseOrder(purchaseOrderId, merchant.id);
      return { ok: true as const, message: "Purchase order cancelled." };
    }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Action failed.",
    };
  }

  return { ok: false as const, message: "Invalid action." };
};

export default function PurchaseOrdersPage() {
  const { purchaseOrders } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Purchase Orders">
      <s-section heading="Create from reorder list">
        <s-paragraph>
          Stockie-style draft POs grouped by supplier using current reorder suggestions.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="actionType" value="create_from_reorder" />
          <s-button type="submit" variant="primary">
            Create draft POs from reorder list
          </s-button>
        </Form>
        {actionData ? (
          <s-paragraph>
            <s-text>{actionData.message}</s-text>
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Purchase orders">
        {purchaseOrders.length === 0 ? (
          <s-paragraph>No purchase orders yet.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "purchase order", plural: "purchase orders" }}
              itemCount={purchaseOrders.length}
              selectable={false}
              headings={[
                { title: "PO #" },
                { title: "Supplier" },
                { title: "Status" },
                { title: "Lines" },
                { title: "Total qty" },
                { title: "Created" },
                { title: "Actions" },
              ]}
            >
              {purchaseOrders.map((po, index) => {
                const totalQty = po.lines.reduce((sum, line) => sum + line.quantity, 0);
                return (
                  <IndexTable.Row id={`po-${po.id}`} key={po.id} position={index}>
                    <IndexTable.Cell>#{po.id}</IndexTable.Cell>
                    <IndexTable.Cell>{po.supplier?.name ?? "Unassigned"}</IndexTable.Cell>
                    <IndexTable.Cell>{poBadge(po.status)}</IndexTable.Cell>
                    <IndexTable.Cell>{po.lines.length}</IndexTable.Cell>
                    <IndexTable.Cell>{totalQty}</IndexTable.Cell>
                    <IndexTable.Cell>{new Date(po.createdAt).toLocaleString()}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <s-stack direction="inline" gap="base">
                        {po.status === PurchaseOrderStatus.DRAFT ? (
                          <Form method="post">
                            <input type="hidden" name="actionType" value="send" />
                            <input type="hidden" name="purchaseOrderId" value={po.id} />
                            <s-button type="submit">Email supplier</s-button>
                          </Form>
                        ) : null}
                        {po.status === PurchaseOrderStatus.SENT ? (
                          <Form method="post">
                            <input type="hidden" name="actionType" value="receive" />
                            <input type="hidden" name="purchaseOrderId" value={po.id} />
                            <s-button type="submit">Mark received</s-button>
                          </Form>
                        ) : null}
                        {po.status === PurchaseOrderStatus.DRAFT ||
                        po.status === PurchaseOrderStatus.SENT ? (
                          <Form method="post">
                            <input type="hidden" name="actionType" value="cancel" />
                            <input type="hidden" name="purchaseOrderId" value={po.id} />
                            <s-button type="submit" tone="critical">
                              Cancel
                            </s-button>
                          </Form>
                        ) : null}
                      </s-stack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </Card>
        )}
      </s-section>

      <s-section heading="Line items">
        {purchaseOrders.length === 0 ? null : (
          <Card>
            <IndexTable
              resourceName={{ singular: "line", plural: "lines" }}
              itemCount={purchaseOrders.reduce((sum, po) => sum + po.lines.length, 0)}
              selectable={false}
              headings={[
                { title: "PO #" },
                { title: "Product" },
                { title: "SKU" },
                { title: "Location" },
                { title: "Qty" },
              ]}
            >
              {purchaseOrders.flatMap((po, poIndex) =>
                po.lines.map((line, lineIndex) => (
                  <IndexTable.Row
                    id={`po-line-${line.id}`}
                    key={line.id}
                    position={poIndex * 100 + lineIndex}
                  >
                    <IndexTable.Cell>#{po.id}</IndexTable.Cell>
                    <IndexTable.Cell>{line.productTitle}</IndexTable.Cell>
                    <IndexTable.Cell>{line.sku || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>{line.locationName || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>{line.quantity}</IndexTable.Cell>
                  </IndexTable.Row>
                )),
              )}
            </IndexTable>
          </Card>
        )}
      </s-section>
    </s-page>
  );
}
