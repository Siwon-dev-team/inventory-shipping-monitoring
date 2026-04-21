ALTER TABLE "NotificationDelivery" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotificationDelivery" ADD COLUMN "maxRetries" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "NotificationDelivery" ADD COLUMN "nextRetryAt" DATETIME;

CREATE INDEX "NotificationDelivery_status_nextRetryAt_idx" ON "NotificationDelivery"("status", "nextRetryAt");

CREATE TABLE "WebhookDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "payloadHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WebhookDelivery_shopDomain_webhookId_key" ON "WebhookDelivery"("shopDomain", "webhookId");
CREATE INDEX "WebhookDelivery_shopDomain_topic_createdAt_idx" ON "WebhookDelivery"("shopDomain", "topic", "createdAt");

