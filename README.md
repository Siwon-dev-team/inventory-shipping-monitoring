# Inventory Shipping Monitoring

Team note: this repo is the Shopify embedded app we are building for low-stock monitoring and shipping-side inventory operations.

## Why this app exists

We need a lightweight app for merchants that:

- catches low stock before stockout
- sends alerts without manual checking in Shopify Admin
- gives basic forecast + reorder suggestion so staff can plan replenishment faster

This is not a full WMS. Scope is focused on inventory visibility and alerting.

## Current product scope in code

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

## Stack

- TypeScript
- Shopify App React Router
- Prisma
- SQLite for local/dev
- Polaris web components
- Vitest for tests

## Local setup

### 1) Install

```bash
npm install
```

### 2) Prepare DB and Prisma client

```bash
npm run setup
```

### 3) Run app

```bash
shopify app dev
```

## Required environment variables

### Shopify

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`

### Cron / operations

- `CRON_SECRET`
- `CRON_BATCH_SIZE` (optional, defaults in code)

### Email

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `ALERT_EMAIL_TO` (fallback if merchant contact email is empty)

## Common commands

- `npm run dev` -> run local app
- `npm run build` -> build production bundle
- `npm run start` -> run production server
- `npm run lint` -> eslint
- `npm run typecheck` -> TypeScript check
- `npm test` -> unit/integration tests

## Operational flow (quick reference)

1. Merchant installs app and enables monitoring.
2. Inventory webhooks + cron reconciliation update stock state.
3. Threshold engine decides level (low/critical/out-of-stock).
4. Alert lifecycle creates/resolves ACTIVE alerts.
5. Notification dispatcher sends and logs delivery status.
6. Forecast service updates velocity, demand forecast, and reorder quantity.

## Before deploying

- Set real production URLs in `shopify.app.toml`.
- Ensure `SHOPIFY_APP_URL` is HTTPS (enforced by code in production).
- Confirm cron caller sends `Authorization: Bearer <CRON_SECRET>`.
- Confirm email credentials are valid.

## Notes for contributors

- Keep business logic in `app/services/*`.
- Keep route handlers thin; no heavy logic in route files.
- Add tests for new threshold/alert/forecast behavior before merge.
