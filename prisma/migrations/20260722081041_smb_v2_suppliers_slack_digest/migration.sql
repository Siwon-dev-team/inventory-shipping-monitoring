-- CreateTable
CREATE TABLE "Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Supplier_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "supplierId" INTEGER,
    "lowThreshold" INTEGER,
    "criticalThreshold" INTEGER,
    "classification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("classification", "createdAt", "criticalThreshold", "id", "lowThreshold", "merchantId", "shopifyProductId", "title", "updatedAt") SELECT "classification", "createdAt", "criticalThreshold", "id", "lowThreshold", "merchantId", "shopifyProductId", "title", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_merchantId_idx" ON "Product"("merchantId");
CREATE UNIQUE INDEX "Product_merchantId_shopifyProductId_key" ON "Product"("merchantId", "shopifyProductId");
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
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Settings" ("createdAt", "globalCriticalThreshold", "globalLowThreshold", "id", "merchantId", "monitoringEnabled", "notifyOnRestocked", "safetyBufferDays", "schedulerIntervalMinutes", "updatedAt") SELECT "createdAt", "globalCriticalThreshold", "globalLowThreshold", "id", "merchantId", "monitoringEnabled", "notifyOnRestocked", "safetyBufferDays", "schedulerIntervalMinutes", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE UNIQUE INDEX "Settings_merchantId_key" ON "Settings"("merchantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Supplier_merchantId_idx" ON "Supplier"("merchantId");
