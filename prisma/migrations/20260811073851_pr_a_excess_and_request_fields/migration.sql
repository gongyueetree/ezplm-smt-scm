-- CreateEnum
CREATE TYPE "ExcessSource" AS ENUM ('EXCEL_IMPORT', 'ERP', 'MANUAL');

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "approvedUnitPrice" DECIMAL(18,6),
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "demandQty" DECIMAL(18,4),
ADD COLUMN     "eta" TIMESTAMP(3),
ADD COLUMN     "excessQty" DECIMAL(18,4),
ADD COLUMN     "internalInventory" DECIMAL(18,4),
ADD COLUMN     "internalPn" TEXT,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "openPoQty" DECIMAL(18,4),
ADD COLUMN     "projectCode" TEXT,
ADD COLUMN     "requiredDate" TIMESTAMP(3),
ADD COLUMN     "selectedBuyQty" DECIMAL(18,4),
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "ExcessSnapshot" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "source" "ExcessSource" NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "importJobId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcessLine" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "customerId" TEXT,
    "partId" TEXT,
    "internalPn" TEXT,
    "mpn" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "availableQty" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ExcessLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExcessSnapshot_tenantId_snapshotAt_idx" ON "ExcessSnapshot"("tenantId", "snapshotAt");

-- CreateIndex
CREATE INDEX "ExcessLine_tenantId_mpn_idx" ON "ExcessLine"("tenantId", "mpn");

-- CreateIndex
CREATE INDEX "ExcessLine_tenantId_customerId_idx" ON "ExcessLine"("tenantId", "customerId");

-- AddForeignKey
ALTER TABLE "ExcessLine" ADD CONSTRAINT "ExcessLine_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ExcessSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
