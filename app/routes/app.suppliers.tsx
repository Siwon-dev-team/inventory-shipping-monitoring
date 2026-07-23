import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { Card, IndexTable } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);

  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({
      where: { merchantId: merchant.id },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: true } },
      },
    }),
    prisma.product.findMany({
      where: { merchantId: merchant.id },
      orderBy: { title: "asc" },
      select: { id: true, title: true, supplierId: true },
    }),
  ]);

  return { suppliers, products };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "");

  if (actionType === "create" || actionType === "update") {
    const id = formData.get("id");
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim() || null;
    const leadTimeDays = Math.max(
      0,
      Number(formData.get("leadTimeDays") ?? 7) || 7,
    );

    if (!name) {
      return { ok: false as const, message: "Supplier name is required." };
    }

    if (actionType === "create") {
      await prisma.supplier.create({
        data: {
          merchantId: merchant.id,
          name,
          email,
          leadTimeDays,
        },
      });
      return { ok: true as const, message: "Supplier created." };
    }

    const supplierId = Number(id);
    if (!Number.isFinite(supplierId)) {
      return { ok: false as const, message: "Invalid supplier." };
    }

    await prisma.supplier.updateMany({
      where: { id: supplierId, merchantId: merchant.id },
      data: { name, email, leadTimeDays },
    });

    return { ok: true as const, message: "Supplier updated." };
  }

  if (actionType === "delete") {
    const supplierId = Number(formData.get("id"));
    if (!Number.isFinite(supplierId)) {
      return { ok: false as const, message: "Invalid supplier." };
    }

    await prisma.product.updateMany({
      where: { merchantId: merchant.id, supplierId },
      data: { supplierId: null },
    });
    await prisma.supplier.deleteMany({
      where: { id: supplierId, merchantId: merchant.id },
    });

    return { ok: true as const, message: "Supplier deleted." };
  }

  if (actionType === "assign_product") {
    const productId = Number(formData.get("productId"));
    const supplierIdRaw = String(formData.get("supplierId") ?? "");
    const supplierId =
      supplierIdRaw.length > 0 ? Number(supplierIdRaw) : null;

    if (!Number.isFinite(productId)) {
      return { ok: false as const, message: "Invalid product." };
    }

    await prisma.product.updateMany({
      where: { id: productId, merchantId: merchant.id },
      data: { supplierId },
    });

    return { ok: true as const, message: "Product supplier updated." };
  }

  return { ok: false as const, message: "Invalid action." };
};

export default function SuppliersPage() {
  const { suppliers, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Suppliers">
      <s-section heading="Add supplier">
        {actionData ? (
          <s-paragraph>
            <s-text>{actionData.message}</s-text>
          </s-paragraph>
        ) : null}
        <Form method="post">
          <input type="hidden" name="actionType" value="create" />
          <s-stack direction="block" gap="base">
            <s-text-field name="name" label="Name" />
            <s-text-field name="email" label="Email" />
            <s-text-field
              name="leadTimeDays"
              label="Lead time (days)"
              value="7"
            />
            <s-button type="submit" variant="primary">
              Add supplier
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Suppliers">
        {suppliers.length === 0 ? (
          <s-paragraph>No suppliers yet.</s-paragraph>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "supplier", plural: "suppliers" }}
              itemCount={suppliers.length}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Email" },
                { title: "Lead time" },
                { title: "Products" },
                { title: "Actions" },
              ]}
            >
              {suppliers.map((supplier, index) => (
                <IndexTable.Row
                  id={`supplier-${supplier.id}`}
                  key={supplier.id}
                  position={index}
                >
                  <IndexTable.Cell>{supplier.name}</IndexTable.Cell>
                  <IndexTable.Cell>{supplier.email || "-"}</IndexTable.Cell>
                  <IndexTable.Cell>{supplier.leadTimeDays} days</IndexTable.Cell>
                  <IndexTable.Cell>{supplier._count.products}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Form method="post">
                      <input type="hidden" name="actionType" value="delete" />
                      <input type="hidden" name="id" value={supplier.id} />
                      <s-button type="submit" tone="critical">
                        Delete
                      </s-button>
                    </Form>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
      </s-section>

      <s-section heading="Edit supplier">
        {suppliers.length === 0 ? (
          <s-paragraph>Add a supplier first.</s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="actionType" value="update" />
            <s-stack direction="block" gap="base">
              <label>
                Supplier
                <select name="id" defaultValue="">
                  <option value="" disabled>
                    Select supplier
                  </option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <s-text-field name="name" label="Name" />
              <s-text-field name="email" label="Email" />
              <s-text-field name="leadTimeDays" label="Lead time (days)" value="7" />
              <s-button type="submit" variant="primary">
                Update supplier
              </s-button>
            </s-stack>
          </Form>
        )}
      </s-section>

      <s-section heading="Assign supplier to product">
        {products.length === 0 ? (
          <s-paragraph>Sync inventory first to load products.</s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="actionType" value="assign_product" />
            <s-stack direction="inline" gap="base">
              <label>
                Product
                <select name="productId" defaultValue="">
                  <option value="" disabled>
                    Select product
                  </option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Supplier
                <select name="supplierId" defaultValue="">
                  <option value="">None</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <s-button type="submit">Assign</s-button>
            </s-stack>
          </Form>
        )}
      </s-section>
    </s-page>
  );
}
