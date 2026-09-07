-- CreateEnum
CREATE TYPE "IntegrationSyncState" AS ENUM ('NOT_CONFIGURED', 'READY', 'PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'RETRY_REQUIRED', 'BLOCKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ErpEntityType" ADD VALUE 'EXCESS';
ALTER TYPE "ErpEntityType" ADD VALUE 'FX_RATE';
ALTER TYPE "ErpEntityType" ADD VALUE 'SUPPLIER';
ALTER TYPE "ErpEntityType" ADD VALUE 'CUSTOMER';
ALTER TYPE "ErpEntityType" ADD VALUE 'AR_AP';

-- AlterEnum
ALTER TYPE "ErpVendor" ADD VALUE 'ERP_LAB';

-- CreateTable
CREATE TABLE "IntegrationSyncRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" "ErpEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "direction" "ErpSyncDirection" NOT NULL,
    "state" "IntegrationSyncState" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "externalId" TEXT,
    "externalDocumentNo" TEXT,
    "idempotencyKey" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedSnapshot" JSONB,
    "lastAttemptAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationSyncRecord_tenantId_state_nextRetryAt_idx" ON "IntegrationSyncRecord"("tenantId", "state", "nextRetryAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncRecord_tenantId_entityType_state_idx" ON "IntegrationSyncRecord"("tenantId", "entityType", "state");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSyncRecord_tenantId_provider_entityType_entityId_key" ON "IntegrationSyncRecord"("tenantId", "provider", "entityType", "entityId", "direction");
