-- CreateEnum
CREATE TYPE "PortalAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PortalInviteStatus" AS ENUM ('PENDING', 'USED', 'REVOKED');

-- AlterTable
ALTER TABLE "PortalAccount" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "status" "PortalAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PortalInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "PortalInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalInvite_tokenHash_key" ON "PortalInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalInvite_tenantId_accountId_idx" ON "PortalInvite"("tenantId", "accountId");

-- R3-3 回填:此前被停用(active=false)的账号,状态一并落 DISABLED(status 真源化)
UPDATE "PortalAccount" SET "status" = 'DISABLED' WHERE "active" = false;
