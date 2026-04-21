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
          <s-stack direction="block" gap="base">
            {rows.map((row) => (
              <s-box key={row.variantId} borderWidth="base" borderRadius="base" padding="base">
                <s-paragraph>
                  {row.title} ({row.sku || "No SKU"})
                </s-paragraph>
                <s-paragraph>
                  Velocity 7d: {row.salesVelocity7d} | Velocity 30d: {row.salesVelocity30d}
                </s-paragraph>
                <s-paragraph>
                  Forecast daily: {row.forecastDaily} | 7d: {row.forecast7d} | 30d: {row.forecast30d}
                </s-paragraph>
                <s-paragraph>
                  Inventory: {row.inventoryQuantity} |{" "}
                  {row.reorderSuggestionQty > 0
                    ? `Reorder suggestion: ${row.reorderSuggestionQty}`
                    : "No reorder needed"}
                </s-paragraph>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

