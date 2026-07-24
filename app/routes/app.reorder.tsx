import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useFetcher, useLoaderData } from "react-router";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import {
  buildReorderList,
  reorderListToCsv,
} from "../services/inventory/reorder-list.server";
import {
  createPurchaseOrdersFromReorderRows,
} from "../services/inventory/purchase-orders.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const url = new URL(request.url);
  const locationIdParam = url.searchParams.get("locationId");
  const locationId = locationIdParam ? Number(locationIdParam) : null;
  const filter = url.searchParams.get("filter");
  const needsReorderOnly = filter === "reorder";
  const deadStockOnly = filter === "dead_stock";

  const locations = await prisma.location.findMany({
    where: { merchantId: merchant.id },
    orderBy: { name: "asc" },
  });

  const { rows, summary } = await buildReorderList({
    merchantId: merchant.id,
    locationId: Number.isFinite(locationId) ? locationId : null,
    needsReorderOnly,
    deadStockOnly,
  });

  return {
    rows,
    summary,
    locations,
    locationId: Number.isFinite(locationId) ? locationId : null,
    filter: filter ?? "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "");

  if (actionType !== "export_csv" && actionType !== "create_pos") {
    return new Response("Invalid action", { status: 400 });
  }

  const locationIdParam = formData.get("locationId");
  const locationId = locationIdParam ? Number(locationIdParam) : null;
  const filter = String(formData.get("filter") ?? "");
  const needsReorderOnly = filter === "reorder";
  const deadStockOnly = filter === "dead_stock";

  const { rows } = await buildReorderList({
    merchantId: merchant.id,
    locationId: Number.isFinite(locationId) ? locationId : null,
    needsReorderOnly,
    deadStockOnly,
  });

  if (actionType === "create_pos") {
    const created = await createPurchaseOrdersFromReorderRows(merchant.id, rows);
    return {
      ok: true as const,
      message: `Created ${created.length} draft purchase order(s).`,
      purchaseOrdersCreated: created.length,
    };
  }

  const csv = reorderListToCsv(rows);
  return csv;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export default function ReorderPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const csvFetcher = useFetcher();
  const downloadTriggered = useRef(false);

  useEffect(() => {
    if (csvFetcher.data && typeof csvFetcher.data === "string" && !downloadTriggered.current) {
      downloadTriggered.current = true;
      const blob = new Blob([csvFetcher.data], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reorder-list-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
    if (csvFetcher.state === "idle" && !csvFetcher.data) {
      downloadTriggered.current = false;
    }
  }, [csvFetcher.data, csvFetcher.state]);

  return (
    <s-page heading="Reorder list">
      <s-section heading="Summary">
        <s-paragraph>
          Stock health: <s-text>{data.summary.stockHealthScore}%</s-text>
        </s-paragraph>
        <s-paragraph>
          Active alerts: <s-text>{data.summary.activeAlerts}</s-text>
        </s-paragraph>
        <s-paragraph>
          SKUs needing reorder: <s-text>{data.summary.needsReorder}</s-text>
        </s-paragraph>
        <s-paragraph>
          Dead stock SKUs: <s-text>{data.summary.deadStockCount}</s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Filters">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <label>
              Location
              <select name="locationId" defaultValue={data.locationId ?? ""}>
                <option value="">All locations</option>
                {data.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              View
              <select name="filter" defaultValue={data.filter}>
                <option value="">All SKUs</option>
                <option value="reorder">Needs attention</option>
                <option value="dead_stock">Dead stock only</option>
              </select>
            </label>
            <s-button type="submit">Apply</s-button>
          </s-stack>
        </Form>
        <csvFetcher.Form method="post">
          <input type="hidden" name="actionType" value="export_csv" />
          {data.locationId ? (
            <input type="hidden" name="locationId" value={data.locationId} />
          ) : null}
          {data.filter ? <input type="hidden" name="filter" value={data.filter} /> : null}
          <s-button type="submit" variant="primary" disabled={csvFetcher.state !== "idle"}>
            {csvFetcher.state !== "idle" ? "Exporting..." : "Export CSV"}
          </s-button>
        </csvFetcher.Form>
        <Form method="post">
          <input type="hidden" name="actionType" value="create_pos" />
          {data.locationId ? (
            <input type="hidden" name="locationId" value={data.locationId} />
          ) : null}
          {data.filter ? <input type="hidden" name="filter" value={data.filter} /> : null}
          <s-button type="submit">Create draft POs</s-button>
        </Form>
        {actionData && typeof actionData === "object" && "message" in actionData ? (
          <s-paragraph>
            <s-text>{actionData.message}</s-text>
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="SKUs ranked by urgency">
        {data.rows.length === 0 ? (
          <s-paragraph>No SKUs match the current filter.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "SKU", plural: "SKUs" }}
              itemCount={data.rows.length}
              selectable={false}
              headings={[
                { title: "Urgency" },
                { title: "Product" },
                { title: "SKU" },
                { title: "Location" },
                { title: "On hand" },
                { title: "Days cover" },
                { title: "Stockout" },
                { title: "Order by" },
                { title: "Reorder qty" },
                { title: "Classification" },
                { title: "Sell-through" },
                { title: "Supplier" },
                { title: "Alert" },
              ]}
            >
              {data.rows.map((row, index) => (
                <IndexTable.Row
                  id={`reorder-${row.variantId}-${row.locationId ?? "default"}`}
                  key={`${row.variantId}-${row.locationId ?? "default"}`}
                  position={index}
                >
                  <IndexTable.Cell>{row.urgencyScore}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.productTitle}
                    {row.isDeadStock ? (
                      <>
                        {" "}
                        <Badge tone="info">Dead stock</Badge>
                      </>
                    ) : null}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.sku || "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{row.locationName || "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{row.inventoryQuantity}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.daysOfCover != null ? row.daysOfCover.toFixed(1) : "-"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(row.stockoutDate)}</IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(row.orderByDate)}</IndexTable.Cell>
                  <IndexTable.Cell>{row.reorderSuggestionQty}</IndexTable.Cell>
                  <IndexTable.Cell>{row.classification}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.sellThroughRate != null ? row.sellThroughRate.toFixed(2) : "-"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.supplierName || "-"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.alertLevel ? (
                      <Badge
                        tone={
                          row.alertLevel === "OUT_OF_STOCK" ||
                          row.alertLevel === "CRITICAL"
                            ? "critical"
                            : "warning"
                        }
                      >
                        {row.alertLevel}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>
    </s-page>
  );
}
