-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "sentAt" DATETIME,
    "receivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseOrderId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "productTitle" TEXT NOT NULL,
    "sku" TEXT,
    "locationName" TEXT,
    "quantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiInsight" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "score" REAL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiInsight_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "globalLowThreshold" INTEGER NOT NULL DEFAULT 5,
    "globalCriticalThreshold" INTEGER,
    "safetyBufferDays" INTEGER NOT NULL DEFAULT 5,
    "notifyOnRestocked" BOOLEAN NOT NULL DEFAULT false,
    "schedulerIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "slackWebhookUrl" TEXT,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "digestFrequency" TEXT NOT NULL DEFAULT 'DAILY',
    "lastDigestSentAt" DATETIME,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("createdAt", "digestEnabled", "globalCriticalThreshold", "globalLowThreshold", "id", "merchantId", "monitoringEnabled", "notifyOnRestocked", "onboardingCompleted", "safetyBufferDays", "schedulerIntervalMinutes", "slackWebhookUrl", "updatedAt") SELECT "createdAt", "digestEnabled", "globalCriticalThreshold", "globalLowThreshold", "id", "merchantId", "monitoringEnabled", "notifyOnRestocked", "onboardingCompleted", "safetyBufferDays", "schedulerIntervalMinutes", "slackWebhookUrl", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_merchantId_key" ON "Settings"("merchantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PurchaseOrder_merchantId_status_idx" ON "PurchaseOrder"("merchantId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "AiInsight_merchantId_createdAt_idx" ON "AiInsight"("merchantId", "createdAt");
