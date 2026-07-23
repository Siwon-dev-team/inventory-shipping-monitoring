import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { recomputeMerchantForecasts } from "../services/inventory/forecast.server";
import { buildReorderList } from "../services/inventory/reorder-list.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function explainReorder(row: {
  reorderSuggestionQty: number;
  forecastDaily: number;
  inventoryQuantity: number;
  daysOfCover: number | null;
  supplierLeadTimeDays: number | null;
}) {
  if (row.reorderSuggestionQty <= 0) {
    return "Inventory covers projected demand with safety buffer.";
  }

  const leadTime = row.supplierLeadTimeDays ?? 0;
  const coverText =
    row.daysOfCover != null ? `${row.daysOfCover.toFixed(1)} days of cover` : "low velocity";
  return `Selling ~${row.forecastDaily.toFixed(1)}/day with ${coverText}. Order ${row.reorderSuggestionQty} units${leadTime > 0 ? ` before lead time (${leadTime}d)` : ""}.`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const settings = await prisma.settings.findUnique({
    where: { merchantId: merchant.id },
  });
  const bufferDays = settings?.safetyBufferDays ?? 5;

  const { rows } = await buildReorderList({
    merchantId: merchant.id,
    needsReorderOnly: false,
  });

  const variantRows = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = variantRows.get(row.variantId);
    if (!existing || row.urgencyScore > existing.urgencyScore) {
      variantRows.set(row.variantId, row);
    }
  }

  const insights = Array.from(variantRows.values())
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .slice(0, 50);

  return { insights, bufferDays, variantCount: variantRows.size };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const result = await recomputeMerchantForecasts(merchant.id);

  return { ok: true as const, result };
};

export default function ForecastingPage() {
  const actionData = useActionData<typeof action>();
  const { insights, bufferDays, variantCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Sales Velocity, Forecasting and Reorder">
      <s-section heading="Recompute">
        <Form method="post">
          <s-button type="submit">Recompute forecast now</s-button>
        </Form>
        {actionData?.ok ? (
          <s-paragraph>
            Updated variants: {actionData.result.variantsUpdated}, products:{" "}
            {actionData.result.productsUpdated}
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="How forecast works">
        <s-paragraph>Weighted daily forecast = (7d avg * 0.6) + (30d avg * 0.4)</s-paragraph>
        <s-paragraph>Safety buffer days: {bufferDays}</s-paragraph>
        <s-paragraph>
          Days of cover = on-hand quantity / forecast daily. Stockout date = today + days of
          cover. Order-by date = stockout date - supplier lead time.
        </s-paragraph>
      </s-section>

      <s-section heading="Variant insights">
        {insights.length === 0 ? (
          <s-paragraph>
            No synced sales data yet. Sync inventory and wait for orders to build velocity.
          </s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "variant insight", plural: "variant insights" }}
              itemCount={insights.length}
              selectable={false}
              headings={[
                { title: "Urgency" },
                { title: "Product" },
                { title: "SKU" },
                { title: "On hand" },
                { title: "Velocity 7d" },
                { title: "Velocity 30d" },
                { title: "Days cover" },
                { title: "Stockout" },
                { title: "Order by" },
                { title: "Reorder" },
                { title: "Why" },
              ]}
            >
              {insights.map((row, index) => (
                <IndexTable.Row id={`forecast-${row.variantId}`} key={row.variantId} position={index}>
                  <IndexTable.Cell>{row.urgencyScore}</IndexTable.Cell>
                  <IndexTable.Cell>{row.productTitle}</IndexTable.Cell>
                  <IndexTable.Cell>{row.sku || "No SKU"}</IndexTable.Cell>
                  <IndexTable.Cell>{row.inventoryQuantity}</IndexTable.Cell>
                  <IndexTable.Cell>{row.velocity7d.toFixed(2)}</IndexTable.Cell>
                  <IndexTable.Cell>{row.velocity30d.toFixed(2)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.daysOfCover != null ? row.daysOfCover.toFixed(1) : "-"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(row.stockoutDate)}</IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(row.orderByDate)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.reorderSuggestionQty > 0 ? (
                      <Badge tone="warning">{String(row.reorderSuggestionQty)}</Badge>
                    ) : (
                      "No reorder"
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{explainReorder(row)}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
        <s-paragraph>
          Showing top {insights.length} of {variantCount} variants by urgency.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
