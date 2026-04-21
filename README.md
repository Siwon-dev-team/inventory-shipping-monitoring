# Inventory Shipping Monitoring

Shopify embedded app for inventory monitoring, alerting, and basic demand
planning.

## Features

- Variant-level inventory monitoring with threshold priority:
  variant -> product -> location -> global
- Multi-level stock states: low, critical, out of stock
- Alert lifecycle: active and resolved
- Notification flow configuration per event/channel
- Sales velocity and weighted forecast
- Reorder quantity suggestions with safety buffer
- Cron reconciliation with webhook idempotency

## Tech Stack

- TypeScript
- Shopify App React Router
- Prisma + SQLite (default)
- Polaris web components
- Vitest for unit/integration tests

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Generate Prisma client and apply migrations:

```bash
npm run setup
```

3. Start development:

```bash
shopify app dev
```

## Scripts

- `npm run dev`: run Shopify app in development
- `npm run build`: build app
- `npm run start`: serve production build
- `npm run lint`: run eslint
- `npm run typecheck`: run TypeScript checks
- `npm test`: run Vitest suite

## Environment Variables

Core:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`

Monitoring/ops:

- `CRON_SECRET`
- `CRON_BATCH_SIZE` (optional)

Email:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `ALERT_EMAIL_TO` (fallback recipient)

## Notes

- In production, `SHOPIFY_APP_URL` must use `https://`.
- Configure real production URLs in `shopify.app.toml` before deployment.
