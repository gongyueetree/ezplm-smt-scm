-- CreateEnum
CREATE TYPE "PartOrigin" AS ENUM ('EZPLM', 'LOCAL', 'IMPORTED', 'ERP');

-- CreateEnum
CREATE TYPE "PartStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PartAttrType" AS ENUM ('TEXT', 'NUMBER', 'RANGE', 'ENUM', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "PartDocKind" AS ENUM ('DATASHEET', 'APPROVAL_SHEET', 'ROHS_REPORT', 'REACH_REPORT', 'COC', 'OTHER');

-- CreateEnum
CREATE TYPE "DuplicateResolution" AS ENUM ('USE_EXISTING', 'MAP_CUSTOMER_PN', 'CREATE_ANYWAY');

-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "origin" "PartOrigin" NOT NULL DEFAULT 'EZPLM',
ADD COLUMN     "status" "PartStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "PartProcessAttr" ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "moq" INTEGER,
ADD COLUMN     "safetyStock" DECIMAL(18,4),
ADD COLUMN     "spq" INTEGER;

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "permission" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartAttributeDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "PartAttrType" NOT NULL DEFAULT 'TEXT',
    "unit" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "categoryL1" TEXT,
    "categoryL2" TEXT,
    "options" JSONB,
    "validation" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartAttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartAttributeValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "value" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "confidence" DOUBLE PRECISION,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "kind" "PartDocKind" NOT NULL DEFAULT 'OTHER',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "version" TEXT,
    "validUntil" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'UPLOAD',
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartSupplierRef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierPn" TEXT,
    "referencePrice" DECIMAL(18,6),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartSupplierRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartCreationRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "createdVia" TEXT NOT NULL DEFAULT 'MANUAL',
    "duplicateCandidates" JSONB,
    "duplicateResolution" "DuplicateResolution",
    "duplicateReason" TEXT,
    "aiEvidence" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartCreationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionGrant_tenantId_role_idx" ON "PermissionGrant"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGrant_tenantId_role_permission_key" ON "PermissionGrant"("tenantId", "role", "permission");

-- CreateIndex
CREATE INDEX "UserPermission_tenantId_userId_idx" ON "UserPermission"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_tenantId_userId_permission_key" ON "UserPermission"("tenantId", "userId", "permission");

-- CreateIndex
CREATE INDEX "PartAttributeDefinition_tenantId_categoryL1_categoryL2_sort_idx" ON "PartAttributeDefinition"("tenantId", "categoryL1", "categoryL2", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PartAttributeDefinition_tenantId_key_key" ON "PartAttributeDefinition"("tenantId", "key");

-- CreateIndex
CREATE INDEX "PartAttributeValue_tenantId_definitionId_idx" ON "PartAttributeValue"("tenantId", "definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "PartAttributeValue_tenantId_partId_definitionId_key" ON "PartAttributeValue"("tenantId", "partId", "definitionId");

-- CreateIndex
CREATE INDEX "PartDocument_tenantId_partId_kind_idx" ON "PartDocument"("tenantId", "partId", "kind");

-- CreateIndex
CREATE INDEX "PartDocument_tenantId_validUntil_idx" ON "PartDocument"("tenantId", "validUntil");

-- CreateIndex
CREATE INDEX "PartSupplierRef_tenantId_supplierId_idx" ON "PartSupplierRef"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PartSupplierRef_tenantId_partId_supplierId_key" ON "PartSupplierRef"("tenantId", "partId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PartCreationRecord_partId_key" ON "PartCreationRecord"("partId");

-- CreateIndex
CREATE INDEX "PartCreationRecord_tenantId_createdVia_idx" ON "PartCreationRecord"("tenantId", "createdVia");

-- CreateIndex
CREATE INDEX "Part_tenantId_origin_status_idx" ON "Part"("tenantId", "origin", "status");

-- AddForeignKey
ALTER TABLE "PartAttributeValue" ADD CONSTRAINT "PartAttributeValue_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartAttributeValue" ADD CONSTRAINT "PartAttributeValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "PartAttributeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartDocument" ADD CONSTRAINT "PartDocument_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartSupplierRef" ADD CONSTRAINT "PartSupplierRef_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartCreationRecord" ADD CONSTRAINT "PartCreationRecord_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
