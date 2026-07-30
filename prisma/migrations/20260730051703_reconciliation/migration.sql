-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('AR', 'AP');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'MATCHED', 'CONFIRMED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReconBaselineSource" AS ENUM ('DERIVED', 'UPLOADED');

-- CreateEnum
CREATE TYPE "ReconLineVerdict" AS ENUM ('CONSISTENT', 'QTY_DIFF', 'PRICE_DIFF', 'AMOUNT_DIFF', 'CURRENCY_MISMATCH', 'ONLY_THEIRS', 'ONLY_OURS');

-- CreateTable
CREATE TABLE "ReconciliationStatement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "ReconciliationKind" NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "baselineSource" "ReconBaselineSource" NOT NULL DEFAULT 'DERIVED',
    "amountTolerance" DECIMAL(18,6) NOT NULL DEFAULT 0.01,
    "matchSnapshot" JSONB,
    "matchedAt" TIMESTAMP(3),
    "lastPreviewAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "matchKey" TEXT NOT NULL,
    "docNo" TEXT,
    "docLineNo" INTEGER,
    "mpn" TEXT,
    "theirQty" DECIMAL(18,4),
    "theirUnitPrice" DECIMAL(18,6),
    "theirAmount" DECIMAL(18,4),
    "theirCurrency" TEXT,
    "ourQty" DECIMAL(18,4),
    "ourUnitPrice" DECIMAL(18,6),
    "ourAmount" DECIMAL(18,4),
    "ourCurrency" TEXT,
    "verdict" "ReconLineVerdict" NOT NULL,
    "diffAmount" DECIMAL(18,4),
    "severity" TEXT NOT NULL,
    "details" JSONB,
    "dueDate" TIMESTAMP(3),
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationStatement_tenantId_kind_status_idx" ON "ReconciliationStatement"("tenantId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationStatement_tenantId_code_key" ON "ReconciliationStatement"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ReconciliationLine_tenantId_verdict_idx" ON "ReconciliationLine"("tenantId", "verdict");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationLine_tenantId_statementId_lineNo_key" ON "ReconciliationLine"("tenantId", "statementId", "lineNo");

-- AddForeignKey
ALTER TABLE "ReconciliationLine" ADD CONSTRAINT "ReconciliationLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "ReconciliationStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
