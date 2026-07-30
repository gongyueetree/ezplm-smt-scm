-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_PRICE_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'EXPORTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PoApprovalStage" AS ENUM ('PRICE_REVIEW', 'FINAL');

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "procurementRfqId" TEXT,
    "purchaseRequestId" TEXT,
    "createdById" TEXT NOT NULL,
    "rejectReason" TEXT,
    "cancelReason" TEXT,
    "supersededById" TEXT,
    "reviewSnapshot" JSONB,
    "approvedSnapshot" JSONB,
    "erpExportedAt" TIMESTAMP(3),
    "erpIntegrationJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "partId" TEXT,
    "mpn" TEXT,
    "manufacturer" TEXT,
    "description" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,6),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "moq" INTEGER,
    "spq" INTEGER,
    "leadTimeDays" INTEGER,
    "requestDate" TIMESTAMP(3),
    "orderByDate" TIMESTAMP(3),
    "sourcingMode" "SourcingMode" NOT NULL DEFAULT 'FUTURES',
    "wasFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReasons" JSONB,
    "historySnapshot" JSONB,
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "stage" "PoApprovalStage" NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_status_idx" ON "PurchaseOrder"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_supplierId_idx" ON "PurchaseOrder"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_poNo_key" ON "PurchaseOrder"("tenantId", "poNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_tenantId_mpn_idx" ON "PurchaseOrderLine"("tenantId", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_tenantId_purchaseOrderId_lineNo_key" ON "PurchaseOrderLine"("tenantId", "purchaseOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderApproval_tenantId_purchaseOrderId_idx" ON "PurchaseOrderApproval"("tenantId", "purchaseOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderApproval" ADD CONSTRAINT "PurchaseOrderApproval_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
