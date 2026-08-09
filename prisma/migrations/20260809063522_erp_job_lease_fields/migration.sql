-- AlterTable
ALTER TABLE "ErpSyncJob" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT;
