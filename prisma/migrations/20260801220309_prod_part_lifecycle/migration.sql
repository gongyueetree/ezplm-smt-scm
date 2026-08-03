-- CreateEnum
CREATE TYPE "ComplianceVerdict" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ComplianceReviewState" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "PartStatus" ADD VALUE 'OBSOLETE';

-- CreateTable
CREATE TABLE "PartCodeRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "includeCategory" BOOLEAN NOT NULL DEFAULT true,
    "separator" TEXT NOT NULL DEFAULT '-',
    "sequenceWidth" INTEGER NOT NULL DEFAULT 4,
    "currentSequence" INTEGER NOT NULL DEFAULT 0,
    "allowManual" BOOLEAN NOT NULL DEFAULT true,
    "categoryL1" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartCodeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartComplianceDeclaration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "verdict" "ComplianceVerdict" NOT NULL DEFAULT 'UNKNOWN',
    "version" TEXT,
    "standard" TEXT,
    "note" TEXT,
    "issuedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "state" "ComplianceReviewState" NOT NULL DEFAULT 'DRAFT',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "sourceSystem" TEXT,
    "externalId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartComplianceDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartComplianceEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartComplianceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartCodeRule_tenantId_categoryL1_enabled_idx" ON "PartCodeRule"("tenantId", "categoryL1", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "PartCodeRule_tenantId_name_key" ON "PartCodeRule"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PartComplianceDeclaration_tenantId_partId_scheme_idx" ON "PartComplianceDeclaration"("tenantId", "partId", "scheme");

-- CreateIndex
CREATE INDEX "PartComplianceDeclaration_tenantId_validUntil_idx" ON "PartComplianceDeclaration"("tenantId", "validUntil");

-- CreateIndex
CREATE INDEX "PartComplianceDeclaration_tenantId_state_idx" ON "PartComplianceDeclaration"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PartComplianceDeclaration_tenantId_partId_scheme_version_key" ON "PartComplianceDeclaration"("tenantId", "partId", "scheme", "version");

-- CreateIndex
CREATE INDEX "PartComplianceEvidence_tenantId_documentId_idx" ON "PartComplianceEvidence"("tenantId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "PartComplianceEvidence_tenantId_declarationId_documentId_key" ON "PartComplianceEvidence"("tenantId", "declarationId", "documentId");

-- AddForeignKey
ALTER TABLE "PartComplianceDeclaration" ADD CONSTRAINT "PartComplianceDeclaration_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartComplianceEvidence" ADD CONSTRAINT "PartComplianceEvidence_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "PartComplianceDeclaration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartComplianceEvidence" ADD CONSTRAINT "PartComplianceEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PartDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
