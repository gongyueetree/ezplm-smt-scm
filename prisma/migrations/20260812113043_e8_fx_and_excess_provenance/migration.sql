-- AlterTable
ALTER TABLE "ExcessSnapshot" ADD COLUMN     "erpConnectionId" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "sourceDocumentId" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "rateType" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceUpdatedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxRate_tenantId_sourceCurrency_targetCurrency_idx" ON "FxRate"("tenantId", "sourceCurrency", "targetCurrency");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_tenantId_sourceCurrency_targetCurrency_effectiveDate_key" ON "FxRate"("tenantId", "sourceCurrency", "targetCurrency", "effectiveDate", "rateType");
