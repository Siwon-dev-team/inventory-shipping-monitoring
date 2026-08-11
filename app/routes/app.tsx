import process from "node:process";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import {
  AppProvider as PolarisAppProvider,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";
import { ensureMerchantSetup } from "../services/merchant-setup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureMerchantSetup(session.shop);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <NavMenu>
          <a href="/app">Dashboard</a>
          <a href="/app/reorder">Reorder list</a>
          <a href="/app/purchase-orders">Purchase orders</a>
          <a href="/app/analytics">ABC analytics</a>
          <a href="/app/alerts">Alerts</a>
          <a href="/app/thresholds">Thresholds</a>
          <a href="/app/forecasting">Forecasting</a>
          <a href="/app/suppliers">Suppliers</a>
          <a href="/app/ai">AI insights</a>
          <a href="/app/rules">Auto-replenishment</a>
          <a href="/app/reports">Weekly reports</a>
          <a href="/app/notifications">Notifications</a>
          <a href="/app/billing">Subscription</a>
        </NavMenu>
        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
