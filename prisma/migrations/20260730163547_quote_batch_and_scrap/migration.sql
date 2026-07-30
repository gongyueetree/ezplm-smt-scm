-- CreateTable
CREATE TABLE "QuoteBatchUpdateJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "totalBoms" INTEGER NOT NULL DEFAULT 0,
    "processedBoms" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteBatchUpdateJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "customerId" TEXT,
    "workOrder" TEXT,
    "mpn" TEXT,
    "issuedQty" DECIMAL(18,4) NOT NULL,
    "scrapQty" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'IMPORTED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapExportTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "columns" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapExportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteBatchUpdateJob_tenantId_status_idx" ON "QuoteBatchUpdateJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ScrapRecord_tenantId_period_idx" ON "ScrapRecord"("tenantId", "period");

-- CreateIndex
CREATE INDEX "ScrapRecord_tenantId_mpn_idx" ON "ScrapRecord"("tenantId", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapExportTemplate_tenantId_name_key" ON "ScrapExportTemplate"("tenantId", "name");
