import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { Badge, Card, IndexTable } from "@shopify/polaris";
import { useEffect, useRef } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  abcAnalyticsToCsv,
  buildAbcAnalyticsRows,
  type AbcClass,
} from "../services/inventory/abc-analytics.server";
import {
  computeSellThroughRate,
  isDeadStock,
} from "../services/inventory/inventory-metrics.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

function abcBadge(abcClass: AbcClass) {
  if (abcClass === "A") return <Badge tone="success">{abcClass}</Badge>;
  if (abcClass === "B") return <Badge tone="warning">{abcClass}</Badge>;
  return <Badge>{abcClass}</Badge>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const url = new URL(request.url);
  const filter = (url.searchParams.get("class") ?? "all") as AbcClass | "all";

  const variants = await prisma.variant.findMany({
    where: { merchantId: merchant.id },
    include: { product: true },
    orderBy: { updatedAt: "desc" },
  });

  const sellThroughByVariant = new Map<number, number | null>();
  const deadStockVariantIds = new Set<number>();

  for (const variant of variants) {
    const velocity30d = variant.salesVelocity30d ?? 0;
    const sold30d = velocity30d * 30;
    sellThroughByVariant.set(
      variant.id,
      computeSellThroughRate(sold30d, variant.inventoryQuantity),
    );
    if (isDeadStock(sold30d, variant.inventoryQuantity)) {
      deadStockVariantIds.add(variant.id);
    }
  }

  const rows = buildAbcAnalyticsRows(variants, sellThroughByVariant, deadStockVariantIds);
  const filteredRows =
    filter === "all" ? rows : rows.filter((row) => row.abcClass === filter);

  const summary = {
    total: rows.length,
    classA: rows.filter((row) => row.abcClass === "A").length,
    classB: rows.filter((row) => row.abcClass === "B").length,
    classC: rows.filter((row) => row.abcClass === "C").length,
    deadStock: rows.filter((row) => row.isDeadStock).length,
  };

  return { rows: filteredRows, summary, filter };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();

  if (String(formData.get("actionType") ?? "") !== "export_csv") {
    return new Response("Invalid action", { status: 400 });
  }

  const filter = String(formData.get("class") ?? "all") as AbcClass | "all";
  const variants = await prisma.variant.findMany({
    where: { merchantId: merchant.id },
    include: { product: true },
  });

  const sellThroughByVariant = new Map<number, number | null>();
  const deadStockVariantIds = new Set<number>();

  for (const variant of variants) {
    const velocity30d = variant.salesVelocity30d ?? 0;
    const sold30d = velocity30d * 30;
    sellThroughByVariant.set(
      variant.id,
      computeSellThroughRate(sold30d, variant.inventoryQuantity),
    );
    if (isDeadStock(sold30d, variant.inventoryQuantity)) {
      deadStockVariantIds.add(variant.id);
    }
  }

  const rows = buildAbcAnalyticsRows(variants, sellThroughByVariant, deadStockVariantIds);
  const filteredRows =
    filter === "all" ? rows : rows.filter((row) => row.abcClass === filter);
  const csv = abcAnalyticsToCsv(filteredRows);

  return csv;
};

export default function AnalyticsPage() {
  const { rows, summary, filter } = useLoaderData<typeof loader>();
  const csvFetcher = useFetcher();
  const downloadTriggered = useRef(false);

  useEffect(() => {
    if (csvFetcher.data && typeof csvFetcher.data === "string" && !downloadTriggered.current) {
      downloadTriggered.current = true;
      const blob = new Blob([csvFetcher.data], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `abc-analytics-${new Date().toISOString().split("T")[0]}.csv`;
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
    <s-page heading="ABC Analytics">
      <s-section heading="Summary">
        <s-paragraph>
          Total SKUs: <s-text>{summary.total}</s-text>
        </s-paragraph>
        <s-paragraph>
          Class A: <s-text>{summary.classA}</s-text> | Class B:{" "}
          <s-text>{summary.classB}</s-text> | Class C: <s-text>{summary.classC}</s-text>
        </s-paragraph>
        <s-paragraph>
          Dead stock: <s-text>{summary.deadStock}</s-text>
        </s-paragraph>
        <s-paragraph>
          Class A = top velocity movers. Class C = slow or dead stock candidates.
        </s-paragraph>
      </s-section>

      <s-section heading="Filters">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <label>
              ABC class
              <select name="class" defaultValue={filter}>
                <option value="all">All</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </label>
            <s-button type="submit">Apply</s-button>
          </s-stack>
        </Form>
        <csvFetcher.Form method="post">
          <input type="hidden" name="actionType" value="export_csv" />
          {filter !== "all" ? <input type="hidden" name="class" value={filter} /> : null}
          <s-button type="submit" variant="primary" disabled={csvFetcher.state !== "idle"}>
            {csvFetcher.state !== "idle" ? "Exporting..." : "Export CSV"}
          </s-button>
        </csvFetcher.Form>
      </s-section>

      <s-section heading="SKU classification">
        {rows.length === 0 ? (
          <s-paragraph>No SKUs match this filter. Sync inventory first.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "SKU", plural: "SKUs" }}
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "ABC" },
                { title: "Product" },
                { title: "SKU" },
                { title: "Velocity 30d" },
                { title: "Sell-through" },
                { title: "On hand" },
                { title: "Classification" },
                { title: "Dead stock" },
              ]}
            >
              {rows.map((row, index) => (
                <IndexTable.Row id={`abc-${row.variantId}`} key={row.variantId} position={index}>
                  <IndexTable.Cell>{abcBadge(row.abcClass)}</IndexTable.Cell>
                  <IndexTable.Cell>{row.productTitle}</IndexTable.Cell>
                  <IndexTable.Cell>{row.sku || "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{row.velocity30d.toFixed(2)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.sellThroughRate != null ? row.sellThroughRate.toFixed(2) : "-"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.inventoryQuantity}</IndexTable.Cell>
                  <IndexTable.Cell>{row.classification}</IndexTable.Cell>
                  <IndexTable.Cell>{row.isDeadStock ? "Yes" : "No"}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>
    </s-page>
  );
}
