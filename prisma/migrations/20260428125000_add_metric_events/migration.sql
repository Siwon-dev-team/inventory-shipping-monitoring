CREATE TABLE "MetricEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "metricKey" TEXT,
    "value" REAL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MetricEvent_merchantId_eventType_createdAt_idx" ON "MetricEvent"("merchantId", "eventType", "createdAt");

