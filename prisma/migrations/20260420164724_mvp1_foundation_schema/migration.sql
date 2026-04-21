-- CreateTable
CREATE TABLE "Merchant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopDomain" TEXT NOT NULL,
    "contactEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "globalLowThreshold" INTEGER NOT NULL DEFAULT 5,
    "globalCriticalThreshold" INTEGER,
    "safetyBufferDays" INTEGER NOT NULL DEFAULT 5,
    "notifyOnRestocked" BOOLEAN NOT NULL DEFAULT false,
    "schedulerIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Location" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "shopifyLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lowThreshold" INTEGER,
    "criticalThreshold" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Location_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lowThreshold" INTEGER,
    "criticalThreshold" INTEGER,
    "classification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "shopifyInventoryItemId" TEXT,
    "sku" TEXT,
    "inventoryQuantity" INTEGER NOT NULL DEFAULT 0,
    "lowThreshold" INTEGER,
    "criticalThreshold" INTEGER,
    "salesVelocity7d" REAL,
    "salesVelocity30d" REAL,
    "forecastDaily" REAL,
    "forecast7d" REAL,
    "forecast30d" REAL,
    "reorderSuggestionQty" INTEGER,
    "lastInventorySyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Variant_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VariantInventory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "variantId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VariantInventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VariantInventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryAlert" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "thresholdValue" INTEGER NOT NULL,
    "currentQuantity" INTEGER NOT NULL,
    "alertStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "alertLevel" TEXT NOT NULL,
    "triggerEvent" TEXT NOT NULL,
    "lastAlertSentAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryAlert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryAlert_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryAlert_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesData" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "sourceOrderId" TEXT,
    "date" DATETIME NOT NULL,
    "quantitySold" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesData_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesData_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationFlow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationFlow_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merchantId" INTEGER NOT NULL,
    "alertId" INTEGER,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT,
    "errorMessage" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationDelivery_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "InventoryAlert" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_shopDomain_key" ON "Merchant"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_merchantId_key" ON "Settings"("merchantId");

-- CreateIndex
CREATE INDEX "Location_merchantId_idx" ON "Location"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_merchantId_shopifyLocationId_key" ON "Location"("merchantId", "shopifyLocationId");

-- CreateIndex
CREATE INDEX "Product_merchantId_idx" ON "Product"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_merchantId_shopifyProductId_key" ON "Product"("merchantId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Variant_merchantId_productId_idx" ON "Variant"("merchantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_merchantId_shopifyVariantId_key" ON "Variant"("merchantId", "shopifyVariantId");

-- CreateIndex
CREATE INDEX "VariantInventory_locationId_idx" ON "VariantInventory"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantInventory_variantId_locationId_key" ON "VariantInventory"("variantId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryAlert_merchantId_alertStatus_alertLevel_idx" ON "InventoryAlert"("merchantId", "alertStatus", "alertLevel");

-- CreateIndex
CREATE INDEX "InventoryAlert_merchantId_variantId_locationId_idx" ON "InventoryAlert"("merchantId", "variantId", "locationId");

-- CreateIndex
CREATE INDEX "SalesData_merchantId_date_idx" ON "SalesData"("merchantId", "date");

-- CreateIndex
CREATE INDEX "SalesData_variantId_date_idx" ON "SalesData"("variantId", "date");

-- CreateIndex
CREATE INDEX "NotificationFlow_merchantId_idx" ON "NotificationFlow"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationFlow_merchantId_event_channel_key" ON "NotificationFlow"("merchantId", "event", "channel");

-- CreateIndex
CREATE INDEX "NotificationDelivery_merchantId_attemptedAt_idx" ON "NotificationDelivery"("merchantId", "attemptedAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");
