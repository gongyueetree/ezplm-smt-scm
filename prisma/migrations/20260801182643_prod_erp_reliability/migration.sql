-- CreateEnum
CREATE TYPE "RetryBackoff" AS ENUM ('FIXED', 'EXPONENTIAL', 'NONE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStatus" ADD VALUE 'PARTIAL_SUCCESS';
ALTER TYPE "JobStatus" ADD VALUE 'RETRYING';
ALTER TYPE "JobStatus" ADD VALUE 'DEAD_LETTER';

-- AlterTable
ALTER TABLE "ErpConnection" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastFailureAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ErpCredential" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ErpSyncJob" ADD COLUMN     "backoffStrategy" "RetryBackoff" NOT NULL DEFAULT 'EXPONENTIAL',
ADD COLUMN     "cursorAfter" TEXT,
ADD COLUMN     "cursorBefore" TEXT,
ADD COLUMN     "lastRetryAt" TIMESTAMP(3),
ADD COLUMN     "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "parentJobId" TEXT,
ADD COLUMN     "resumeFromLineNo" INTEGER,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ErpSyncJobLine" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "erpDocumentId" TEXT,
ADD COLUMN     "erpLineId" TEXT,
ADD COLUMN     "erpResponse" JSONB,
ADD COLUMN     "erpStatus" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "postedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ErpSyncPolicy" ADD COLUMN     "lastExternalTimestamp" TEXT,
ADD COLUMN     "lastSuccessfulAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessfulCursor" TEXT,
ADD COLUMN     "pageToken" TEXT;

-- CreateIndex
CREATE INDEX "ErpSyncJob_tenantId_status_nextRetryAt_idx" ON "ErpSyncJob"("tenantId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "ErpSyncJob_tenantId_parentJobId_idx" ON "ErpSyncJob"("tenantId", "parentJobId");

-- CreateIndex
CREATE INDEX "ErpSyncJobLine_tenantId_erpDocumentId_idx" ON "ErpSyncJobLine"("tenantId", "erpDocumentId");
