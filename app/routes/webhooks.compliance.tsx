import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logger } from "../services/logger.server";

type CompliancePayload = {
  shop_id: number;
  shop_domain: string;
  customer?: {
    id?: number;
    email?: string;
    phone?: string;
  };
  orders_requested?: number[];
  orders_to_redact?: number[];
  data_request?: {
    id?: number;
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const compliancePayload = payload as CompliancePayload;

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      logger.info("Received CUSTOMERS_DATA_REQUEST webhook", {
        shop,
        requestId: compliancePayload.data_request?.id ?? "unknown",
      });
      break;
    case "CUSTOMERS_REDACT":
      logger.info("Received CUSTOMERS_REDACT webhook", { shop });
      break;
    case "SHOP_REDACT":
      logger.info("Received SHOP_REDACT webhook", { shop });
      break;
    default:
      logger.warn("Received unsupported compliance webhook topic", { shop, topic });
  }

  return new Response(null, { status: 200 });
};
