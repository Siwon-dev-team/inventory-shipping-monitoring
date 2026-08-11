-- CreateTable
CREATE TABLE "Subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "shopifySubscriptionId" TEXT,
    "dailyQueryCount" INTEGER NOT NULL DEFAULT 0,
    "dailyQueryLimit" INTEGER NOT NULL DEFAULT 20,
    "queryResetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" DATETIME,
    "currentPeriodStart" DATETIME,
    "currentPeriodEnd" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailySalesSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "revenue" REAL NOT NULL DEFAULT 0,
    "inventoryQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailySalesSnapshot_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplenishmentRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "triggerValue" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "supplierId" INTEGER,
    "locationId" INTEGER,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReplenishmentRule_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "weekEnd" DATETIME NOT NULL,
    "summary" TEXT NOT NULL,
    "topProducts" TEXT,
    "concerns" TEXT,
    "actionItems" TEXT,
    "metrics" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyReport_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_merchantId_key" ON "Subscription"("merchantId");

-- CreateIndex
CREATE INDEX "DailySalesSnapshot_merchantId_date_idx" ON "DailySalesSnapshot"("merchantId", "date");

-- CreateIndex
CREATE INDEX "DailySalesSnapshot_variantId_date_idx" ON "DailySalesSnapshot"("variantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySalesSnapshot_merchantId_variantId_date_key" ON "DailySalesSnapshot"("merchantId", "variantId", "date");

-- CreateIndex
CREATE INDEX "ReplenishmentRule_merchantId_enabled_idx" ON "ReplenishmentRule"("merchantId", "enabled");

-- CreateIndex
CREATE INDEX "WeeklyReport_merchantId_createdAt_idx" ON "WeeklyReport"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReport_merchantId_weekStart_key" ON "WeeklyReport"("merchantId", "weekStart");
