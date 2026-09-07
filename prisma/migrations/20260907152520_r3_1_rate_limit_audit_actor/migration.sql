-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('INTERNAL_USER', 'PORTAL_ACCOUNT', 'SUPPLIER_LINK', 'SYSTEM', 'INTEGRATION');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorDisplay" TEXT,
ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "actorType" "ActorType";

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","bucketStart")
);

-- CreateIndex
CREATE INDEX "RateLimitBucket_bucketStart_idx" ON "RateLimitBucket"("bucketStart");
