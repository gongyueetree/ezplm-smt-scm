-- CreateTable
CREATE TABLE "BomCostSelection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomVersionId" TEXT NOT NULL,
    "bomLineId" TEXT NOT NULL,
    "partId" TEXT,
    "partMfgMappingId" TEXT,
    "selectedSource" TEXT NOT NULL,
    "selectedSupplierId" TEXT,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceQtyBasis" TEXT NOT NULL,
    "effectiveBuyQty" DECIMAL(18,4) NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "unapprovedSource" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomCostSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomCostSelection_tenantId_bomVersionId_idx" ON "BomCostSelection"("tenantId", "bomVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "BomCostSelection_tenantId_bomLineId_key" ON "BomCostSelection"("tenantId", "bomLineId");

