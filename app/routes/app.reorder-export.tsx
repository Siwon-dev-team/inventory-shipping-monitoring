import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import {
  buildReorderList,
  reorderListToCsv,
} from "../services/inventory/reorder-list.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const url = new URL(request.url);
  const locationIdParam = url.searchParams.get("locationId");
  const locationId = locationIdParam ? Number(locationIdParam) : null;
  const filter = url.searchParams.get("filter");
  const needsReorderOnly = filter === "reorder";
  const deadStockOnly = filter === "dead_stock";

  const { rows } = await buildReorderList({
    merchantId: merchant.id,
    locationId: Number.isFinite(locationId) ? locationId : null,
    needsReorderOnly,
    deadStockOnly,
  });

  const csv = reorderListToCsv(rows);
  const timestamp = new Date().toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reorder-list-${timestamp}.csv"`,
    },
  });
};
