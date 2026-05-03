import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { recomputeMerchantForecasts } from "../services/inventory/forecast.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

type ForecastRow = {
  variantId: number;
  title: string;
  sku: string | null;
  inventoryQuantity: number;
  salesVelocity7d: number;
  salesVelocity30d: number;
  forecastDaily: number;
  forecast7d: number;
  forecast30d: number;
  reorderSuggestionQty: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const settings = await prisma.settings.findUnique({
    where: { merchantId: merchant.id },
  });
  const bufferDays = settings?.safetyBufferDays ?? 5;

  const variants = await prisma.variant.findMany({
    where: { merchantId: merchant.id },
    include: { product: true },
    take: 200,
    orderBy: { updatedAt: "desc" },
  });

  const rows: ForecastRow[] = variants.map((variant) => ({
      variantId: variant.id,
      title: variant.product.title,
      sku: variant.sku,
      inventoryQuantity: variant.inventoryQuantity,
      salesVelocity7d: variant.salesVelocity7d ?? 0,
      salesVelocity30d: variant.salesVelocity30d ?? 0,
      forecastDaily: variant.forecastDaily ?? 0,
      forecast7d: variant.forecast7d ?? 0,
      forecast30d: variant.forecast30d ?? 0,
      reorderSuggestionQty: variant.reorderSuggestionQty ?? 0,
    }));

  return { rows, bufferDays };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const result = await recomputeMerchantForecasts(merchant.id);

  return { ok: true as const, result };
};

export default function ForecastingPage() {
  const actionData = useActionData<typeof action>();
  const { rows, bufferDays } = useLoaderData<typeof loader>();

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
      <s-section heading="Model">
        <s-paragraph>Weighted daily forecast = (7d avg * 0.6) + (30d avg * 0.4)</s-paragraph>
        <s-paragraph>Safety buffer days: {bufferDays}</s-paragraph>
      </s-section>

      <s-section heading="Variant insights">
        {rows.length === 0 ? (
          <s-paragraph>No synced sales data yet.</s-paragraph>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Inventory</th>
                <th>Velocity 7d</th>
                <th>Velocity 30d</th>
                <th>Forecast daily</th>
                <th>Forecast 7d</th>
                <th>Forecast 30d</th>
                <th>Reorder</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.variantId}>
                  <td>{row.title}</td>
                  <td>{row.sku || "No SKU"}</td>
                  <td>{row.inventoryQuantity}</td>
                  <td>{row.salesVelocity7d.toFixed(2)}</td>
                  <td>{row.salesVelocity30d.toFixed(2)}</td>
                  <td>{row.forecastDaily.toFixed(2)}</td>
                  <td>{row.forecast7d.toFixed(2)}</td>
                  <td>{row.forecast30d.toFixed(2)}</td>
                  <td>
                    {row.reorderSuggestionQty > 0
                      ? row.reorderSuggestionQty
                      : "No reorder needed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

