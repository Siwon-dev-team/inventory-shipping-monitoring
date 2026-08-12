import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  const url = new URL(request.url);
  const redirectUrl = url.searchParams.get("url");
  
  if (!redirectUrl) {
    throw new Response("Missing redirect URL", { status: 400 });
  }
  
  return { redirectUrl };
};

export default function BillingRedirect() {
  const { redirectUrl } = useLoaderData<typeof loader>();

  useEffect(() => {
    // For embedded apps, we need to redirect the top-level window
    // Using window.open with _top target works for Shopify admin
    if (redirectUrl) {
      window.open(redirectUrl, "_top");
    }
  }, [redirectUrl]);

  return (
    <div style={{ 
      display: "flex", 
      justifyContent: "center", 
      alignItems: "center", 
      height: "100vh",
      flexDirection: "column",
      gap: "16px"
    }}>
      <div className="Polaris-Spinner Polaris-Spinner--sizeLarge">
        <svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" style={{ width: "44px", height: "44px" }}>
          <circle 
            cx="22" 
            cy="22" 
            r="20" 
            fill="none" 
            strokeWidth="3"
            stroke="#5c6ac4"
            strokeDasharray="89"
            strokeLinecap="round"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 22 22"
              to="360 22 22"
              dur="0.8s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>
      <p style={{ color: "#637381", fontSize: "14px" }}>
        Redirecting to Shopify billing...
      </p>
    </div>
  );
}
