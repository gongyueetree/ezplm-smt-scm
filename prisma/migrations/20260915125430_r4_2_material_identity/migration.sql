-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('ELECTRONIC_COMPONENT', 'PCB_BARE_BOARD', 'MECHANICAL', 'CABLE', 'ASSEMBLY', 'CONSUMABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "PartMfgIdentifierKind" AS ENUM ('COMPONENT_MPN', 'PCB_PART_NO', 'MECHANICAL_PART_NO', 'ASSEMBLY_PART_NO', 'VENDOR_PART_NO', 'OTHER');

-- CreateEnum
CREATE TYPE "PartMfgMatchMode" AS ENUM ('EXACT', 'PATTERN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PartMfgRelationType" AS ENUM ('PRIMARY', 'APPROVED', 'ALTERNATE', 'HISTORICAL', 'MAINTAINED');

-- CreateEnum
CREATE TYPE "PartMfgMappingStatus" AS ENUM ('CANDIDATE', 'APPROVED', 'REJECTED', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "PartMfgMappingSource" AS ENUM ('ERP_MFG_MAINTENANCE', 'MANUAL_APPROVED', 'CUSTOMER_AVL', 'PO_HISTORY', 'IMPORT', 'EZPLM', 'LEGACY_BACKFILL');

-- CreateEnum
CREATE TYPE "MfgResolutionStatus" AS ENUM ('RESOLVED', 'CANDIDATE', 'CONFLICT', 'UNRESOLVED');

-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "materialKind" "MaterialKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "materialKindConfidence" DECIMAL(4,3),
ADD COLUMN     "materialKindSource" TEXT;

-- CreateTable
CREATE TABLE "PartMfgMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "rawManufacturer" TEXT,
    "rawManufacturerPartNo" TEXT NOT NULL,
    "canonicalManufacturerId" TEXT,
    "canonicalManufacturerName" TEXT,
    "manufacturerPartNo" TEXT NOT NULL,
    "manufacturerPartNoKey" TEXT NOT NULL,
    "manufacturerKey" TEXT NOT NULL DEFAULT '',
    "materialKind" "MaterialKind" NOT NULL,
    "identifierKind" "PartMfgIdentifierKind" NOT NULL,
    "identifierMatchMode" "PartMfgMatchMode" NOT NULL,
    "relationType" "PartMfgRelationType" NOT NULL,
    "status" "PartMfgMappingStatus" NOT NULL,
    "source" "PartMfgMappingSource" NOT NULL,
    "sourceDocumentNo" TEXT,
    "sourceLineId" TEXT,
    "sourceRow" INTEGER,
    "sourceCreatedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "manufacturerResolutionStatus" "MfgResolutionStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "manufacturerResolutionConfidence" DECIMAL(4,3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartMfgMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartMfgMapping_tenantId_partId_idx" ON "PartMfgMapping"("tenantId", "partId");

-- CreateIndex
CREATE INDEX "PartMfgMapping_tenantId_manufacturerPartNoKey_idx" ON "PartMfgMapping"("tenantId", "manufacturerPartNoKey");

-- CreateIndex
CREATE INDEX "PartMfgMapping_tenantId_status_idx" ON "PartMfgMapping"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PartMfgMapping_tenantId_source_idx" ON "PartMfgMapping"("tenantId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "PartMfgMapping_tenantId_partId_manufacturerPartNoKey_manufa_key" ON "PartMfgMapping"("tenantId", "partId", "manufacturerPartNoKey", "manufacturerKey");

-- CreateIndex
CREATE INDEX "Part_tenantId_materialKind_idx" ON "Part"("tenantId", "materialKind");

-- AddForeignKey
ALTER TABLE "PartMfgMapping" ADD CONSTRAINT "PartMfgMapping_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- R4-2 §23 legacy backfill:现有 Part.mpn/manufacturer 生成 PartMfgMapping
-- (COMPONENT_MPN / LEGACY_BACKFILL / PRIMARY / APPROVED);原字段保留为 preferred 缓存。
-- Key 规则与 lib/domain/part-mfg.ts 完全一致:upper + 去非字母数字。
INSERT INTO "PartMfgMapping" (
  "id", "tenantId", "partId",
  "rawManufacturer", "rawManufacturerPartNo",
  "manufacturerPartNo", "manufacturerPartNoKey", "manufacturerKey",
  "materialKind", "identifierKind", "identifierMatchMode",
  "relationType", "status", "source",
  "firstSeenAt", "lastSeenAt", "evidenceCount",
  "manufacturerResolutionStatus", "createdAt", "updatedAt"
)
SELECT
  'pmm_' || substr(md5(p."id"), 1, 24), p."tenantId", p."id",
  p."manufacturer", p."mpn",
  p."mpn", regexp_replace(upper(p."mpn"), '[^0-9A-Z]', '', 'g'),
  regexp_replace(upper(coalesce(p."manufacturer", '')), '[^0-9A-Z]', '', 'g'),
  'ELECTRONIC_COMPONENT'::"MaterialKind", 'COMPONENT_MPN'::"PartMfgIdentifierKind",
  CASE WHEN p."mpn" LIKE '%*%' THEN 'PATTERN'::"PartMfgMatchMode" ELSE 'EXACT'::"PartMfgMatchMode" END,
  'PRIMARY'::"PartMfgRelationType", 'APPROVED'::"PartMfgMappingStatus", 'LEGACY_BACKFILL'::"PartMfgMappingSource",
  p."createdAt", now(), 1,
  'UNRESOLVED'::"MfgResolutionStatus", now(), now()
FROM "Part" p
WHERE p."mpn" IS NOT NULL AND btrim(p."mpn") <> '';

-- 既有 Part 全部来自元器件管线(BOM 匹配/ezPLM/手工建料)——
-- 有 MPN 的回填 ELECTRONIC_COMPONENT(来源标 LEGACY_BACKFILL 语义,置信度不写=未分类动作)
UPDATE "Part" SET "materialKind" = 'ELECTRONIC_COMPONENT'
WHERE "mpn" IS NOT NULL AND btrim("mpn") <> '';
