-- CreateEnum
CREATE TYPE "SupplierOfferStatus" AS ENUM ('RECEIVED', 'REVIEWED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "SupplierOffer" ADD COLUMN     "procurementRfqId" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "SupplierOfferStatus" NOT NULL DEFAULT 'RECEIVED';

-- CreateTable
CREATE TABLE "ProcurementRfqSupplierLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procurementRfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "partId" TEXT,
    "internalPn" TEXT,
    "mpn" TEXT,
    "manufacturer" TEXT,
    "description" TEXT,
    "requestedQty" DECIMAL(18,4) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementRfqSupplierLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcurementRfqSupplierLine_tenantId_procurementRfqId_suppli_idx" ON "ProcurementRfqSupplierLine"("tenantId", "procurementRfqId", "supplierId");

