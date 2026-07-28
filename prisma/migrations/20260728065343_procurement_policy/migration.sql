-- CreateTable
CREATE TABLE "ProcurementPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "maxUnitPrice" DECIMAL(18,6),
    "maxLeadTimeDays" INTEGER,
    "confirmedByBusiness" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementPolicy_tenantId_key" ON "ProcurementPolicy"("tenantId");
