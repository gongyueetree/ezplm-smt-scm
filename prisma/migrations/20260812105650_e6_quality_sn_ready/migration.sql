-- CreateEnum
CREATE TYPE "QualityEventType" AS ENUM ('INCOMING', 'PROCESS', 'CUSTOMER_COMPLAINT', 'SUPPLIER', 'TRACE_INCIDENT', 'OTHER');

-- AlterTable
ALTER TABLE "QualityIncident" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "detectedAt" TIMESTAMP(3),
ADD COLUMN     "eventType" "QualityEventType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "mpn" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "partId" TEXT,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "sn" TEXT,
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "traceAnalysisId" TEXT;

-- CreateTable
CREATE TABLE "FinishedGoodsSerial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sn" TEXT NOT NULL,
    "finishedLotId" TEXT,
    "workOrderId" TEXT,
    "productId" TEXT,
    "mesExternalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MES_IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodsSerial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinishedGoodsSerial_tenantId_finishedLotId_idx" ON "FinishedGoodsSerial"("tenantId", "finishedLotId");

-- CreateIndex
CREATE INDEX "FinishedGoodsSerial_tenantId_workOrderId_idx" ON "FinishedGoodsSerial"("tenantId", "workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodsSerial_tenantId_sn_key" ON "FinishedGoodsSerial"("tenantId", "sn");
