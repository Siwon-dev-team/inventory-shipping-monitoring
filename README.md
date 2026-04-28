# Inventory Shipping Monitoring

Internal Shopify app for inventory monitoring, alerting, and basic demand planning.

## Purpose

This app is built to:

- detect low stock before stockout
- send alerts without manual inventory checks
- estimate short-term demand and suggest reorder quantity

It is not a warehouse management system. Scope is inventory visibility and alert lifecycle.

## Implemented Scope

- Variant-level monitoring
- Threshold priority:
  - Variant override
  - Product override
  - Location override
  - Global fallback
- Alert levels:
  - Low
  - Critical
  - Out of stock
- Alert lifecycle:
  - ACTIVE
  - RESOLVED
- Notification flow by event/channel (email is implemented, SMS/OTT prepared)
- Sales velocity + weighted forecast
- Reorder suggestion with safety buffer
- Webhook idempotency + cron reconciliation

## Tech Stack

- TypeScript
- Shopify App React Router
- Prisma
- SQLite for local/dev
- Polaris web components
- Vitest for tests

## Local Setup

1) Install dependencies

```bash
npm install
```

2) Prepare Prisma client and run migrations

```bash
npm run setup
```

3) Start app

```bash
shopify app dev
```

## Required Environment Variables

Shopify:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`

Cron / Operations:

- `CRON_SECRET`
- `CRON_BATCH_SIZE` (optional)
- `SYNC_PRODUCTS_PAGE_SIZE` (optional)
- `SYNC_VARIANTS_PAGE_SIZE` (optional)
- `SYNC_INVENTORY_LEVELS_PAGE_SIZE` (optional)

Email:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`  
- `ALERT_EMAIL_TO` (fallback recipient)

## Commands

- `npm run dev` -> run local app
- `npm run build` -> build production bundle
- `npm run start` -> run production server
- `npm run lint` -> eslint
- `npm run typecheck` -> TypeScript check
- `npm test` -> unit/integration tests

## Runtime Flow

1. Merchant installs app and enables monitoring.
2. Inventory webhooks + cron reconciliation update stock state.
3. Threshold engine decides level (low/critical/out-of-stock).
4. Alert lifecycle creates/resolves ACTIVE alerts.
5. Notification dispatcher sends and logs delivery status.
6. Forecast service updates velocity, demand forecast, and reorder quantity.

## Deployment Checklist

- Replace placeholder URLs in `shopify.app.toml` before deploy.
- Use HTTPS production domain for `SHOPIFY_APP_URL`.
- Set all required production env vars.
- Use strong `CRON_SECRET` (minimum 24 chars).
- Ensure cron caller sends `Authorization: Bearer <CRON_SECRET>`.
- Verify email credentials.
- Production startup performs fail-fast readiness checks and exits on invalid config.

## Development Conventions

- Keep business logic in `app/services/*`.
- Keep route handlers thin.
- Add tests for threshold/alert/forecast logic changes.
