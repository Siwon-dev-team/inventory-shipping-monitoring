-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PurchaseOrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "purchaseOrderId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "locationId" INTEGER,
    "productTitle" TEXT NOT NULL,
    "sku" TEXT,
    "locationName" TEXT,
    "quantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrderLine" ("createdAt", "id", "locationName", "productTitle", "purchaseOrderId", "quantity", "sku", "updatedAt", "variantId") SELECT "createdAt", "id", "locationName", "productTitle", "purchaseOrderId", "quantity", "sku", "updatedAt", "variantId" FROM "PurchaseOrderLine";
DROP TABLE "PurchaseOrderLine";
ALTER TABLE "new_PurchaseOrderLine" RENAME TO "PurchaseOrderLine";
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
