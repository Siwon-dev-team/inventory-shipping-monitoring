import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_PRODUCTION_ENV = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "CRON_SECRET",
] as const;

function isPlaceholderHost(url: URL) {
  const host = url.hostname.toLowerCase();
  return (
    host === "example.com" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".trycloudflare.com")
  );
}

function validateShopifyToml() {
  const configPath = join(process.cwd(), "shopify.app.toml");
  if (!existsSync(configPath)) return;

  const config = readFileSync(configPath, "utf-8");
  const hasExampleUrl = config.includes("https://example.com");
  if (hasExampleUrl) {
    throw new Error(
      "shopify.app.toml still contains example.com placeholders. Set real production URLs before deploy.",
    );
  }
}

export function validateProductionReadiness() {
  const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }

  const appUrlRaw = process.env.SHOPIFY_APP_URL!;
  let appUrl: URL;
  try {
    appUrl = new URL(appUrlRaw);
  } catch {
    throw new Error("SHOPIFY_APP_URL is not a valid URL");
  }

  if (appUrl.protocol !== "https:") {
    throw new Error("SHOPIFY_APP_URL must use HTTPS in production");
  }

  if (isPlaceholderHost(appUrl)) {
    throw new Error(
      "SHOPIFY_APP_URL is still a local/tunnel/placeholder domain. Use the real production domain.",
    );
  }

  const cronSecret = process.env.CRON_SECRET!;
  if (cronSecret.length < 24) {
    throw new Error("CRON_SECRET must be at least 24 characters in production");
  }

  const scopes = process.env.SCOPES!;
  if (!scopes.trim()) {
    throw new Error("SCOPES cannot be empty in production");
  }

  validateShopifyToml();
}

