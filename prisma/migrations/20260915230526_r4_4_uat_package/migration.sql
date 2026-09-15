-- AlterTable
ALTER TABLE "ExcessLine" ADD COLUMN     "customerNameRaw" TEXT,
ADD COLUMN     "customerPnRaw" TEXT,
ADD COLUMN     "excessQtyInclOpo" DECIMAL(18,4),
ADD COLUMN     "lastBusinessAt" TIMESTAMP(3),
ADD COLUMN     "moq" DECIMAL(18,4),
ADD COLUMN     "standardUnitPrice" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "InventorySnapshot" ADD COLUMN     "availableQty" DECIMAL(18,4),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "internalPn" TEXT,
ADD COLUMN     "lotNo" TEXT,
ADD COLUMN     "ownerNameRaw" TEXT,
ADD COLUMN     "ownerType" TEXT,
ADD COLUMN     "reservedQty" DECIMAL(18,4),
ADD COLUMN     "unit" TEXT,
ALTER COLUMN "partId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ErpUatImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "fileManifest" JSONB NOT NULL,
    "counts" JSONB NOT NULL,
    "reconciliation" JSONB NOT NULL,
    "aliasOverrideHash" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ErpUatImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErpUatImportBatch_tenantId_importedAt_idx" ON "ErpUatImportBatch"("tenantId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpUatImportBatch_tenantId_datasetVersion_key" ON "ErpUatImportBatch"("tenantId", "datasetVersion");

-- CreateIndex
CREATE INDEX "ExcessLine_tenantId_internalPn_idx" ON "ExcessLine"("tenantId", "internalPn");

-- CreateIndex
CREATE INDEX "InventorySnapshot_tenantId_internalPn_idx" ON "InventorySnapshot"("tenantId", "internalPn");

-- CreateIndex
CREATE INDEX "InventorySnapshot_tenantId_importBatchId_idx" ON "InventorySnapshot"("tenantId", "importBatchId");
