-- CreateEnum
CREATE TYPE "SupplierActionKind" AS ENUM ('PO_CONFIRM', 'OPO_ETA', 'CALL_MATERIAL', 'RFQ_QUOTE');

-- CreateEnum
CREATE TYPE "SupplierActionStatus" AS ENUM ('PENDING', 'RESPONDED', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "ReplySource" ADD VALUE 'LINK';

-- CreateTable
CREATE TABLE "SupplierActionRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "SupplierActionKind" NOT NULL,
    "supplierId" TEXT NOT NULL,
    "relatedEntityType" TEXT NOT NULL,
    "relatedEntityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "SupplierActionStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "respondedByName" TEXT,
    "respondedByEmail" TEXT,
    "responsePayload" JSONB,
    "responseIp" TEXT,
    "responseUa" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierActionRequest_tokenHash_key" ON "SupplierActionRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierActionRequest_tenantId_kind_status_idx" ON "SupplierActionRequest"("tenantId", "kind", "status");

-- CreateIndex
CREATE INDEX "SupplierActionRequest_tenantId_relatedEntityId_idx" ON "SupplierActionRequest"("tenantId", "relatedEntityId");
