import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

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
      console.log(
        `Received ${topic} webhook for ${shop}: request ${compliancePayload.data_request?.id ?? "unknown"}`,
      );
      break;
    case "CUSTOMERS_REDACT":
      console.log(`Received ${topic} webhook for ${shop}`);
      break;
    case "SHOP_REDACT":
      console.log(`Received ${topic} webhook for ${shop}`);
      break;
    default:
      console.log(`Received unsupported compliance webhook topic ${topic} for ${shop}`);
  }

  return new Response(null, { status: 200 });
};
