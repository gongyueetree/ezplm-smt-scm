-- DropIndex
DROP INDEX "PartSupplierRef_tenantId_partId_supplierId_key";

-- AlterTable
ALTER TABLE "PartSupplierRef" ADD COLUMN     "allocationPercent" DECIMAL(5,2),
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "isApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPreferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "moq" DECIMAL(18,4),
ADD COLUMN     "partMfgMappingId" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "spq" DECIMAL(18,4);

-- CreateIndex
CREATE INDEX "PartSupplierRef_tenantId_partId_isBlocked_idx" ON "PartSupplierRef"("tenantId", "partId", "isBlocked");

-- CreateIndex
CREATE UNIQUE INDEX "PartSupplierRef_tenantId_partId_supplierId_partMfgMappingId_key" ON "PartSupplierRef"("tenantId", "partId", "supplierId", "partMfgMappingId");

