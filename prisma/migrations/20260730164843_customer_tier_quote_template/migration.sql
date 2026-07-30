-- CreateEnum
CREATE TYPE "CustomerTier" AS ENUM ('A', 'B', 'C');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "tier" "CustomerTier";

-- CreateTable
CREATE TABLE "QuoteTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "CustomerTier",
    "defaultMarkupPct" DECIMAL(10,6),
    "laborTemplateId" TEXT,
    "confirmedByBusiness" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteTemplate_tenantId_tier_idx" ON "QuoteTemplate"("tenantId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTemplate_tenantId_name_key" ON "QuoteTemplate"("tenantId", "name");
