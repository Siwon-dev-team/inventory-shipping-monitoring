import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

type ThresholdTargetType = "variant" | "product" | "location";

type SelectedTarget = {
  targetType: ThresholdTargetType;
  targetId: number;
  label: string;
  lowThreshold: number | null;
  criticalThreshold: number | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const scope = (url.searchParams.get("scope") ?? "all").toLowerCase();
  const editType = (url.searchParams.get("editType") ?? "").toLowerCase();
  const editId = Number(url.searchParams.get("editId"));

  const includeVariant = scope === "all" || scope === "variant";
  const includeProduct = scope === "all" || scope === "product";
  const includeLocation = scope === "all" || scope === "location";

  const queryFilter = query
    ? {
        OR: [
          { sku: { contains: query } },
          {
            product: {
              title: { contains: query },
            },
          },
        ],
      }
    : {};

  const variants = includeVariant
    ? await prisma.variant.findMany({
        where: {
          merchantId: merchant.id,
          ...queryFilter,
        },
        include: {
          product: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      })
    : [];

  const products = includeProduct
    ? await prisma.product.findMany({
        where: {
          merchantId: merchant.id,
          ...(query
            ? {
                title: { contains: query },
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      })
    : [];

  const locations = includeLocation
    ? await prisma.location.findMany({
        where: {
          merchantId: merchant.id,
          ...(query
            ? {
                name: { contains: query },
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      })
    : [];

  let selectedTarget: SelectedTarget | null = null;

  if (editType === "variant" && Number.isFinite(editId) && editId > 0) {
    const variant = await prisma.variant.findFirst({
      where: { id: editId, merchantId: merchant.id },
      include: { product: true },
    });
    if (variant) {
      selectedTarget = {
        targetType: "variant",
        targetId: variant.id,
        label: `${variant.product.title} (${variant.sku || "No SKU"})`,
        lowThreshold: variant.lowThreshold,
        criticalThreshold: variant.criticalThreshold,
      };
    }
  } else if (editType === "product" && Number.isFinite(editId) && editId > 0) {
    const product = await prisma.product.findFirst({
      where: { id: editId, merchantId: merchant.id },
    });
    if (product) {
      selectedTarget = {
        targetType: "product",
        targetId: product.id,
        label: product.title,
        lowThreshold: product.lowThreshold,
        criticalThreshold: product.criticalThreshold,
      };
    }
  } else if (editType === "location" && Number.isFinite(editId) && editId > 0) {
    const location = await prisma.location.findFirst({
      where: { id: editId, merchantId: merchant.id },
    });
    if (location) {
      selectedTarget = {
        targetType: "location",
        targetId: location.id,
        label: location.name,
        lowThreshold: location.lowThreshold,
        criticalThreshold: location.criticalThreshold,
      };
    }
  }

  return { variants, products, locations, query, scope, selectedTarget };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const targetType = String(formData.get("targetType") ?? "variant") as ThresholdTargetType;
  const targetId = Number(formData.get("targetId"));

  const lowThreshold = Number(formData.get("lowThreshold"));
  const criticalThreshold = Number(formData.get("criticalThreshold"));

  if (!Number.isFinite(targetId) || targetId <= 0) {
    return { ok: false, message: "Invalid threshold target." };
  }

  if (!Number.isFinite(lowThreshold) || lowThreshold <= 0) {
    return { ok: false, message: "Low threshold must be greater than 0." };
  }

  const nextLow = Math.max(1, Math.floor(lowThreshold));
  const nextCritical = Number.isFinite(criticalThreshold)
    ? Math.max(0, Math.floor(criticalThreshold))
    : null;
  if (nextCritical !== null && nextCritical > nextLow) {
    return { ok: false, message: "Critical threshold must be less than or equal to low threshold." };
  }

  if (targetType === "variant") {
    await prisma.variant.updateMany({
      where: { id: targetId, merchantId: merchant.id },
      data: {
        lowThreshold: nextLow,
        criticalThreshold: nextCritical,
      },
    });
  } else if (targetType === "product") {
    await prisma.product.updateMany({
      where: { id: targetId, merchantId: merchant.id },
      data: {
        lowThreshold: nextLow,
        criticalThreshold: nextCritical,
      },
    });
  } else if (targetType === "location") {
    await prisma.location.updateMany({
      where: { id: targetId, merchantId: merchant.id },
      data: {
        lowThreshold: nextLow,
        criticalThreshold: nextCritical,
      },
    });
  } else {
    return { ok: false, message: "Unsupported threshold target." };
  }

  return { ok: true, message: "Threshold saved." };
};

export default function ThresholdsPage() {
  const { variants, products, locations, query, scope, selectedTarget } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Threshold Configuration">
      <s-section heading="Search and filter">
        <s-paragraph>
          Threshold priority: Variant - Product - Location - Global
        </s-paragraph>
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <s-text-field name="q" label="Search by title, SKU, or location" value={query} />
            <label>
              Scope
              <select name="scope" defaultValue={scope}>
                <option value="all">All</option>
                <option value="variant">Variant</option>
                <option value="product">Product</option>
                <option value="location">Location</option>
              </select>
            </label>
            <s-button type="submit">Apply filter</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Set threshold">
        {actionData ? (
          <s-paragraph>
            <s-text>{actionData.message}</s-text>
          </s-paragraph>
        ) : null}
        {selectedTarget ? (
          <s-box borderWidth="base" borderRadius="base" padding="base">
            <s-paragraph>
              Editing: <s-text>{selectedTarget.label}</s-text>
            </s-paragraph>
            <Form method="post">
              <input type="hidden" name="targetType" value={selectedTarget.targetType} />
              <input type="hidden" name="targetId" value={selectedTarget.targetId} />
              <s-stack direction="inline" gap="base">
                <label>
                  Low
                  <input
                    type="number"
                    name="lowThreshold"
                    min={1}
                    defaultValue={selectedTarget.lowThreshold ?? 5}
                    required
                  />
                </label>
                <label>
                  Critical
                  <input
                    type="number"
                    name="criticalThreshold"
                    min={0}
                    defaultValue={
                      selectedTarget.criticalThreshold ?? Math.max(1, (selectedTarget.lowThreshold ?? 5) - 2)
                    }
                  />
                </label>
                <s-button type="submit" variant="primary">
                  Save threshold
                </s-button>
              </s-stack>
            </Form>
          </s-box>
        ) : (
          <s-paragraph>Use the list below and click Set threshold.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Variant thresholds">
        {variants.length === 0 ? (
          <s-paragraph>No variants matched your filter.</s-paragraph>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Low</th>
                <th>Critical</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id}>
                  <td>{variant.product.title}</td>
                  <td>{variant.sku || "No SKU"}</td>
                  <td>{variant.lowThreshold ?? "-"}</td>
                  <td>{variant.criticalThreshold ?? "-"}</td>
                  <td>
                    <Form method="get">
                      <input type="hidden" name="q" value={query} />
                      <input type="hidden" name="scope" value={scope} />
                      <input type="hidden" name="editType" value="variant" />
                      <input type="hidden" name="editId" value={variant.id} />
                      <s-button type="submit" variant="tertiary">
                        Set threshold
                      </s-button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Product thresholds">
        {products.length === 0 ? (
          <s-paragraph>No products matched your filter.</s-paragraph>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Low</th>
                <th>Critical</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.title}</td>
                  <td>{product.lowThreshold ?? "-"}</td>
                  <td>{product.criticalThreshold ?? "-"}</td>
                  <td>
                    <Form method="get">
                      <input type="hidden" name="q" value={query} />
                      <input type="hidden" name="scope" value={scope} />
                      <input type="hidden" name="editType" value="product" />
                      <input type="hidden" name="editId" value={product.id} />
                      <s-button type="submit" variant="tertiary">
                        Set threshold
                      </s-button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Location thresholds">
        {locations.length === 0 ? (
          <s-paragraph>No locations matched your filter.</s-paragraph>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Low</th>
                <th>Critical</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id}>
                  <td>{location.name}</td>
                  <td>{location.lowThreshold ?? "-"}</td>
                  <td>{location.criticalThreshold ?? "-"}</td>
                  <td>
                    <Form method="get">
                      <input type="hidden" name="q" value={query} />
                      <input type="hidden" name="scope" value={scope} />
                      <input type="hidden" name="editType" value="location" />
                      <input type="hidden" name="editId" value={location.id} />
                      <s-button type="submit" variant="tertiary">
                        Set threshold
                      </s-button>
                    </Form>
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

