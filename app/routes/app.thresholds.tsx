import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Pagination,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { useState } from "react";

type ThresholdTargetType = "variant" | "product" | "location";
const PAGE_SIZE_MIN = 50;
const PAGE_SIZE_MAX = 100;
const DEFAULT_PAGE_SIZE = 50;

type SelectedTarget = {
  targetType: ThresholdTargetType;
  targetId: number;
  label: string;
  lowThreshold: number | null;
  criticalThreshold: number | null;
};

function normalizeScope(scope: string | null): ThresholdTargetType {
  if (scope === "product" || scope === "location") {
    return scope;
  }
  return "variant";
}

function clampPageSize(input: number) {
  if (!Number.isFinite(input)) return DEFAULT_PAGE_SIZE;
  return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.floor(input)));
}

function formatThreshold(value: number | null, tone: "warning" | "critical") {
  if (value === null) return "-";
  return <Badge tone={tone}>{String(value)}</Badge>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const scope = normalizeScope(url.searchParams.get("scope"));
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = clampPageSize(Number(url.searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE));
  const editType = (url.searchParams.get("editType") ?? "").toLowerCase();
  const editId = Number(url.searchParams.get("editId"));
  const skip = (page - 1) * pageSize;

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

  const variants =
    scope === "variant"
      ? await prisma.variant.findMany({
        where: {
          merchantId: merchant.id,
          ...queryFilter,
        },
        include: {
          product: true,
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
      })
      : [];
  const variantCount =
    scope === "variant"
      ? await prisma.variant.count({
        where: {
          merchantId: merchant.id,
          ...queryFilter,
        },
      })
      : 0;

  const products =
    scope === "product"
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
        skip,
        take: pageSize,
      })
      : [];
  const productCount =
    scope === "product"
      ? await prisma.product.count({
        where: {
          merchantId: merchant.id,
          ...(query
            ? {
                title: { contains: query },
              }
            : {}),
        },
      })
      : 0;

  const locations =
    scope === "location"
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
        skip,
        take: pageSize,
      })
      : [];
  const locationCount =
    scope === "location"
      ? await prisma.location.count({
        where: {
          merchantId: merchant.id,
          ...(query
            ? {
                name: { contains: query },
              }
            : {}),
        },
      })
      : 0;

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

  const totalCount =
    scope === "variant" ? variantCount : scope === "product" ? productCount : locationCount;

  return {
    variants,
    products,
    locations,
    query,
    scope,
    page,
    pageSize,
    totalCount,
    hasPreviousPage: page > 1,
    hasNextPage: page * pageSize < totalCount,
    selectedTarget,
  };
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
  const {
    variants,
    products,
    locations,
    query,
    scope,
    page,
    pageSize,
    totalCount,
    hasPreviousPage,
    hasNextPage,
    selectedTarget,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const [queryValue, setQueryValue] = useState(query);
  const [scopeValue, setScopeValue] = useState(scope);
  const [pageSizeValue, setPageSizeValue] = useState(String(pageSize));

  function buildThresholdEditUrl(editType: ThresholdTargetType, editId: number) {
    const params = new URLSearchParams({
      q: query,
      scope,
      page: String(page),
      pageSize: String(pageSize),
      editType,
      editId: String(editId),
    });
    return `/app/thresholds?${params.toString()}`;
  }

  function buildPageUrl(nextPage: number) {
    const params = new URLSearchParams({
      q: query,
      scope,
      page: String(nextPage),
      pageSize: String(pageSize),
    });
    return `/app/thresholds?${params.toString()}`;
  }

  return (
    <s-page heading="Threshold Configuration">
      <s-section heading="Search and filter">
        <s-paragraph>
          Threshold priority: Variant - Product - Location - Global
        </s-paragraph>
        <Form method="get">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="start" gap="400" blockAlign="end" wrap>
                <input type="hidden" name="page" value="1" />
                <div style={{ minWidth: "280px" }}>
                  <TextField
                    label="Search"
                    name="q"
                    value={queryValue}
                    onChange={setQueryValue}
                    autoComplete="off"
                    placeholder="Search by title, SKU, or location"
                  />
                </div>
                <div style={{ minWidth: "200px" }}>
                  <Select
                    label="Scope"
                    name="scope"
                    options={[
                      { label: "Variant", value: "variant" },
                      { label: "Product", value: "product" },
                      { label: "Location", value: "location" },
                    ]}
                    value={scopeValue}
                    onChange={(value) => setScopeValue(normalizeScope(value))}
                  />
                </div>
                <div style={{ minWidth: "160px" }}>
                  <Select
                    label="Rows per page"
                    name="pageSize"
                    options={[
                      { label: "50", value: "50" },
                      { label: "75", value: "75" },
                      { label: "100", value: "100" },
                    ]}
                    value={pageSizeValue}
                    onChange={setPageSizeValue}
                  />
                </div>
                <Button submit variant="primary">
                  Apply filters
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {totalCount} result(s) found. Page {page}, limit {pageSize} rows.
              </Text>
            </BlockStack>
          </Card>
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
            <s-paragraph>
              <Badge tone="info">{selectedTarget.targetType.toUpperCase()}</Badge>
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
        {scope !== "variant" ? (
          <s-paragraph>Switch scope to Variant to view this table.</s-paragraph>
        ) : variants.length === 0 ? (
          <s-paragraph>No variants matched your filter.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "variant threshold", plural: "variant thresholds" }}
              itemCount={variants.length}
              selectable={false}
              headings={[
                { title: "Product" },
                { title: "SKU" },
                { title: "Low" },
                { title: "Critical" },
                { title: "Action" },
              ]}
            >
              {variants.map((variant, index) => (
                <IndexTable.Row id={`variant-${variant.id}`} key={variant.id} position={index}>
                  <IndexTable.Cell>{variant.product.title}</IndexTable.Cell>
                  <IndexTable.Cell>{variant.sku || "No SKU"}</IndexTable.Cell>
                  <IndexTable.Cell>{formatThreshold(variant.lowThreshold, "warning")}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {formatThreshold(variant.criticalThreshold, "critical")}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button onClick={() => navigate(buildThresholdEditUrl("variant", variant.id))} size="slim">
                      Set threshold
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>

      <s-section heading="Product thresholds">
        {scope !== "product" ? (
          <s-paragraph>Switch scope to Product to view this table.</s-paragraph>
        ) : products.length === 0 ? (
          <s-paragraph>No products matched your filter.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "product threshold", plural: "product thresholds" }}
              itemCount={products.length}
              selectable={false}
              headings={[
                { title: "Product" },
                { title: "Low" },
                { title: "Critical" },
                { title: "Action" },
              ]}
            >
              {products.map((product, index) => (
                <IndexTable.Row id={`product-${product.id}`} key={product.id} position={index}>
                  <IndexTable.Cell>{product.title}</IndexTable.Cell>
                  <IndexTable.Cell>{formatThreshold(product.lowThreshold, "warning")}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {formatThreshold(product.criticalThreshold, "critical")}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button onClick={() => navigate(buildThresholdEditUrl("product", product.id))} size="slim">
                      Set threshold
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>

      <s-section heading="Location thresholds">
        {scope !== "location" ? (
          <s-paragraph>Switch scope to Location to view this table.</s-paragraph>
        ) : locations.length === 0 ? (
          <s-paragraph>No locations matched your filter.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "location threshold", plural: "location thresholds" }}
              itemCount={locations.length}
              selectable={false}
              headings={[
                { title: "Location" },
                { title: "Low" },
                { title: "Critical" },
                { title: "Action" },
              ]}
            >
              {locations.map((location, index) => (
                <IndexTable.Row id={`location-${location.id}`} key={location.id} position={index}>
                  <IndexTable.Cell>{location.name}</IndexTable.Cell>
                  <IndexTable.Cell>{formatThreshold(location.lowThreshold, "warning")}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {formatThreshold(location.criticalThreshold, "critical")}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button onClick={() => navigate(buildThresholdEditUrl("location", location.id))} size="slim">
                      Set threshold
                    </Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>
      <s-section heading="Pagination">
        <Card>
          <BlockStack gap="300">
            <Pagination
              hasPrevious={hasPreviousPage}
              hasNext={hasNextPage}
              onPrevious={() => navigate(buildPageUrl(page - 1))}
              onNext={() => navigate(buildPageUrl(page + 1))}
            />
            <Text as="p" variant="bodySm" tone="subdued">
              Showing page {page} of {Math.max(1, Math.ceil(totalCount / pageSize))}
            </Text>
          </BlockStack>
        </Card>
      </s-section>
    </s-page>
  );
}

