import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { recomputeMerchantForecasts } from "../services/inventory/forecast.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";
import { syncInventoryFromShopify } from "../services/inventory/sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await ensureMerchantSetup(session.shop);
  const settings = await prisma.settings.findUnique({
    where: { merchantId: merchant.id },
  });
  if (!settings) {
    return Response.json({ ok: false, message: "Missing settings" }, { status: 400 });
  }

  const stats = await syncInventoryFromShopify({
    admin,
    merchantId: merchant.id,
    settings,
  });
  const forecastStats = await recomputeMerchantForecasts(merchant.id);

  return Response.json({ ok: true, stats, forecastStats });
};

