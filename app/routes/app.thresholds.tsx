import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const variants = await prisma.variant.findMany({
    where: { merchantId: merchant.id },
    include: {
      product: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const locations = await prisma.location.findMany({
    where: { merchantId: merchant.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return { variants, products, locations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const targetType = String(formData.get("targetType") ?? "variant");

  const variantId = Number(formData.get("variantId"));
  const productId = Number(formData.get("productId"));
  const locationId = Number(formData.get("locationId"));
  const lowThreshold = Number(formData.get("lowThreshold"));
  const criticalThreshold = Number(formData.get("criticalThreshold"));

  if (!Number.isFinite(lowThreshold)) {
    return { ok: false };
  }

  const nextLow = Math.max(1, Math.floor(lowThreshold));
  const nextCritical = Number.isFinite(criticalThreshold)
    ? Math.max(0, Math.floor(criticalThreshold))
    : null;

  if (targetType === "variant") {
    if (!variantId) return { ok: false };
    await prisma.variant.updateMany({
      where: { id: variantId, merchantId: merchant.id },
      data: {
        lowThreshold: nextLow,
        criticalThreshold: nextCritical,
      },
    });
  } else if (targetType === "product") {
    if (!productId) return { ok: false };
    await prisma.product.updateMany({
      where: { id: productId, merchantId: merchant.id },
      data: {
        lowThreshold: nextLow,
        criticalThreshold: nextCritical,
      },
    });
  } else if (targetType === "location") {
    if (!locationId) return { ok: false };
    await prisma.location.updateMany({
      where: { id: locationId, merchantId: merchant.id },
      data: {
        lowThreshold: nextLow,
        criticalThreshold: nextCritical,
      },
    });
  } else {
    return { ok: false };
  }

  return { ok: true };
};

export default function ThresholdsPage() {
  const { variants, products, locations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Threshold Configuration">
      <s-section heading="Variant thresholds">
        <s-paragraph>
          Threshold priority: Variant - Product - Location - Global
        </s-paragraph>
        {actionData?.ok ? (
          <s-paragraph>
            <s-text>Saved variant threshold.</s-text>
          </s-paragraph>
        ) : null}
        {variants.length === 0 ? (
          <s-paragraph>No variants synced yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {variants.map((variant) => (
              <s-box key={variant.id} borderWidth="base" borderRadius="base" padding="base">
                <s-paragraph>
                  {variant.product.title} ({variant.sku || "No SKU"})
                </s-paragraph>
                <Form method="post">
                  <input type="hidden" name="targetType" value="variant" />
                  <input type="hidden" name="variantId" value={variant.id} />
                  <s-stack direction="inline" gap="base">
                    <s-text-field
                      name="lowThreshold"
                      label="Low"
                      value={String(variant.lowThreshold ?? "")}
                    />
                    <s-text-field
                      name="criticalThreshold"
                      label="Critical"
                      value={String(variant.criticalThreshold ?? "")}
                    />
                    <s-button type="submit">Save</s-button>
                  </s-stack>
                </Form>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Product thresholds">
        {products.length === 0 ? (
          <s-paragraph>No products synced yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map((product) => (
              <s-box key={product.id} borderWidth="base" borderRadius="base" padding="base">
                <s-paragraph>{product.title}</s-paragraph>
                <Form method="post">
                  <input type="hidden" name="targetType" value="product" />
                  <input type="hidden" name="productId" value={product.id} />
                  <s-stack direction="inline" gap="base">
                    <s-text-field
                      name="lowThreshold"
                      label="Low"
                      value={String(product.lowThreshold ?? "")}
                    />
                    <s-text-field
                      name="criticalThreshold"
                      label="Critical"
                      value={String(product.criticalThreshold ?? "")}
                    />
                    <s-button type="submit">Save</s-button>
                  </s-stack>
                </Form>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Location thresholds">
        {locations.length === 0 ? (
          <s-paragraph>No locations synced yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {locations.map((location) => (
              <s-box key={location.id} borderWidth="base" borderRadius="base" padding="base">
                <s-paragraph>{location.name}</s-paragraph>
                <Form method="post">
                  <input type="hidden" name="targetType" value="location" />
                  <input type="hidden" name="locationId" value={location.id} />
                  <s-stack direction="inline" gap="base">
                    <s-text-field
                      name="lowThreshold"
                      label="Low"
                      value={String(location.lowThreshold ?? "")}
                    />
                    <s-text-field
                      name="criticalThreshold"
                      label="Critical"
                      value={String(location.criticalThreshold ?? "")}
                    />
                    <s-button type="submit">Save</s-button>
                  </s-stack>
                </Form>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

