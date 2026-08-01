-- CreateEnum
CREATE TYPE "TraceEventKind" AS ENUM ('RECEIVED', 'ISSUED', 'RETURNED', 'PRODUCED', 'SHIPPED', 'REWORK', 'REPAIR', 'SCRAP', 'RETURN', 'RETEST', 'REPACKAGE', 'SPLIT', 'MERGE', 'FREEZE', 'UNFREEZE', 'OTHER');

-- CreateEnum
CREATE TYPE "TraceConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TraceEdgeKind" ADD VALUE 'LOT_SPLIT';
ALTER TYPE "TraceEdgeKind" ADD VALUE 'LOT_MERGE';

-- AlterTable
ALTER TABLE "FinishedGoodsLot" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MaterialLot" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReceiptLot" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TraceEdge" ADD COLUMN     "baseQuantity" DECIMAL(18,6),
ADD COLUMN     "baseUom" TEXT,
ADD COLUMN     "conversionFactor" DECIMAL(18,6),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "quantity" DECIMAL(18,6),
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "uom" TEXT;

-- AlterTable
ALTER TABLE "TraceEvent" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "kind" "TraceEventKind",
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TraceShipment" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TraceWorkOrder" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkOrderMaterialIssue" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalLineId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LotSplitMerge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceLotNos" TEXT[],
    "targetLotNos" TEXT[],
    "quantities" DECIMAL(18,6)[],
    "uom" TEXT,
    "reason" TEXT,
    "operator" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" "TraceSource" NOT NULL DEFAULT 'IMPORT',
    "sourceSystem" TEXT,
    "sourceConnectionId" TEXT,
    "externalId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotSplitMerge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceSubstitution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderNo" TEXT NOT NULL,
    "bomMpn" TEXT,
    "bomInternalPn" TEXT,
    "actualMpn" TEXT,
    "actualInternalPn" TEXT,
    "actualLotNo" TEXT,
    "quantity" DECIMAL(18,6),
    "uom" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalReason" TEXT,
    "source" "TraceSource" NOT NULL DEFAULT 'IMPORT',
    "sourceSystem" TEXT,
    "sourceConnectionId" TEXT,
    "externalId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceSubstitution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceAnalysisRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "analysisAsOf" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "dataGapSnapshot" JSONB,
    "confidence" "TraceConfidence" NOT NULL,
    "coverageScore" INTEGER NOT NULL,
    "inputVersion" TEXT,
    "incidentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotSplitMerge_tenantId_kind_occurredAt_idx" ON "LotSplitMerge"("tenantId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "LotSplitMerge_tenantId_externalId_idx" ON "LotSplitMerge"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "TraceSubstitution_tenantId_workOrderNo_idx" ON "TraceSubstitution"("tenantId", "workOrderNo");

-- CreateIndex
CREATE INDEX "TraceSubstitution_tenantId_actualLotNo_idx" ON "TraceSubstitution"("tenantId", "actualLotNo");

-- CreateIndex
CREATE INDEX "TraceSubstitution_tenantId_bomMpn_idx" ON "TraceSubstitution"("tenantId", "bomMpn");

-- CreateIndex
CREATE INDEX "TraceAnalysisRun_tenantId_sourceRef_analysisAsOf_idx" ON "TraceAnalysisRun"("tenantId", "sourceRef", "analysisAsOf");

-- CreateIndex
CREATE INDEX "TraceAnalysisRun_tenantId_incidentId_idx" ON "TraceAnalysisRun"("tenantId", "incidentId");
