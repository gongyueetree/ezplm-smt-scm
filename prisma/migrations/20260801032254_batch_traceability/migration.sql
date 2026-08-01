-- CreateEnum
CREATE TYPE "TraceSource" AS ENUM ('IMPORT', 'ERP_SYNC', 'MANUAL', 'MES');

-- CreateEnum
CREATE TYPE "TraceEdgeKind" AS ENUM ('PO_TO_RECEIPT', 'RECEIPT_TO_LOT', 'LOT_TO_ISSUE', 'ISSUE_TO_WORK_ORDER', 'WORK_ORDER_TO_FG_LOT', 'FG_LOT_TO_SHIPMENT', 'SHIPMENT_TO_CUSTOMER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'CONTAINED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContainmentKind" AS ENUM ('FREEZE_LOT', 'PAUSE_WORK_ORDER', 'MARK_RECHECK', 'DRAFT_RMA', 'NOTIFY_SUPPLIER', 'NOTIFY_CUSTOMER', 'CREATE_CAPA', 'RECALL_ASSESSMENT', 'EXPORT_QUARANTINE_LIST');

-- CreateEnum
CREATE TYPE "ContainmentState" AS ENUM ('SUGGESTED', 'PENDING_APPROVAL', 'REGISTERED_LOCALLY', 'PENDING_EXTERNAL', 'EXTERNAL_CONFIRMED', 'FAILED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AgentType" ADD VALUE 'TRACE';

-- CreateTable
CREATE TABLE "TraceImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "fileKey" TEXT,
    "fileName" TEXT,
    "source" "TraceSource" NOT NULL DEFAULT 'IMPORT',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "okRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "idempotencyKey" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "poNo" TEXT,
    "poLineNo" INTEGER,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "mpn" TEXT,
    "internalPn" TEXT,
    "supplierLot" TEXT,
    "internalLot" TEXT NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "dateCode" TEXT,
    "warehouse" TEXT,
    "location" TEXT,
    "source" "TraceSource" NOT NULL DEFAULT 'IMPORT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "mpn" TEXT,
    "internalPn" TEXT,
    "receivedQty" DECIMAL(18,4) NOT NULL,
    "frozenAt" TIMESTAMP(3),
    "frozenById" TEXT,
    "frozenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceWorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderNo" TEXT NOT NULL,
    "product" TEXT,
    "bomVersion" TEXT,
    "plannedQty" DECIMAL(18,4),
    "productionLine" TEXT,
    "startAt" TIMESTAMP(3),
    "needDate" TIMESTAMP(3),
    "status" TEXT,
    "pausedAt" TIMESTAMP(3),
    "pausedById" TEXT,
    "pausedReason" TEXT,
    "source" "TraceSource" NOT NULL DEFAULT 'IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderMaterialIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "workOrderNo" TEXT NOT NULL,
    "lotNo" TEXT NOT NULL,
    "mpn" TEXT,
    "issuedQty" DECIMAL(18,4) NOT NULL,
    "returnedQty" DECIMAL(18,4),
    "issuedAt" TIMESTAMP(3),
    "operator" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderMaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinishedGoodsLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fgLotNo" TEXT NOT NULL,
    "workOrderNo" TEXT,
    "product" TEXT,
    "producedQty" DECIMAL(18,4),
    "producedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinishedGoodsLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceShipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentNo" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPo" TEXT,
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceShipmentLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "fgLotNo" TEXT NOT NULL,
    "shippedQty" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceEdge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "TraceEdgeKind" NOT NULL,
    "fromRef" TEXT NOT NULL,
    "toRef" TEXT NOT NULL,
    "qty" DECIMAL(18,4),
    "occurredAt" TIMESTAMP(3),
    "source" "TraceSource" NOT NULL DEFAULT 'IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" "TraceSource" NOT NULL DEFAULT 'IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityIncident" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "impactSnapshot" JSONB,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainmentAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" "ContainmentKind" NOT NULL,
    "targetRef" TEXT NOT NULL,
    "state" "ContainmentState" NOT NULL DEFAULT 'SUGGESTED',
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "externalRef" TEXT,
    "externalNote" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContainmentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TraceImportBatch_tenantId_template_createdAt_idx" ON "TraceImportBatch"("tenantId", "template", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TraceImportBatch_tenantId_idempotencyKey_key" ON "TraceImportBatch"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ReceiptLot_tenantId_poNo_poLineNo_idx" ON "ReceiptLot"("tenantId", "poNo", "poLineNo");

-- CreateIndex
CREATE INDEX "ReceiptLot_tenantId_mpn_idx" ON "ReceiptLot"("tenantId", "mpn");

-- CreateIndex
CREATE INDEX "ReceiptLot_tenantId_supplierLot_idx" ON "ReceiptLot"("tenantId", "supplierLot");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptLot_tenantId_internalLot_key" ON "ReceiptLot"("tenantId", "internalLot");

-- CreateIndex
CREATE INDEX "MaterialLot_tenantId_mpn_idx" ON "MaterialLot"("tenantId", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialLot_tenantId_lotNo_key" ON "MaterialLot"("tenantId", "lotNo");

-- CreateIndex
CREATE UNIQUE INDEX "TraceWorkOrder_tenantId_workOrderNo_key" ON "TraceWorkOrder"("tenantId", "workOrderNo");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialIssue_tenantId_lotNo_idx" ON "WorkOrderMaterialIssue"("tenantId", "lotNo");

-- CreateIndex
CREATE INDEX "WorkOrderMaterialIssue_tenantId_workOrderNo_idx" ON "WorkOrderMaterialIssue"("tenantId", "workOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderMaterialIssue_tenantId_workOrderNo_lotNo_key" ON "WorkOrderMaterialIssue"("tenantId", "workOrderNo", "lotNo");

-- CreateIndex
CREATE INDEX "FinishedGoodsLot_tenantId_workOrderNo_idx" ON "FinishedGoodsLot"("tenantId", "workOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "FinishedGoodsLot_tenantId_fgLotNo_key" ON "FinishedGoodsLot"("tenantId", "fgLotNo");

-- CreateIndex
CREATE INDEX "TraceShipment_tenantId_customerId_idx" ON "TraceShipment"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "TraceShipment_tenantId_shipmentNo_key" ON "TraceShipment"("tenantId", "shipmentNo");

-- CreateIndex
CREATE INDEX "TraceShipmentLine_tenantId_fgLotNo_idx" ON "TraceShipmentLine"("tenantId", "fgLotNo");

-- CreateIndex
CREATE UNIQUE INDEX "TraceShipmentLine_tenantId_shipmentId_fgLotNo_key" ON "TraceShipmentLine"("tenantId", "shipmentId", "fgLotNo");

-- CreateIndex
CREATE INDEX "TraceEdge_tenantId_fromRef_idx" ON "TraceEdge"("tenantId", "fromRef");

-- CreateIndex
CREATE INDEX "TraceEdge_tenantId_toRef_idx" ON "TraceEdge"("tenantId", "toRef");

-- CreateIndex
CREATE UNIQUE INDEX "TraceEdge_tenantId_kind_fromRef_toRef_key" ON "TraceEdge"("tenantId", "kind", "fromRef", "toRef");

-- CreateIndex
CREATE INDEX "TraceEvent_tenantId_ref_occurredAt_idx" ON "TraceEvent"("tenantId", "ref", "occurredAt");

-- CreateIndex
CREATE INDEX "QualityIncident_tenantId_status_idx" ON "QualityIncident"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QualityIncident_tenantId_code_key" ON "QualityIncident"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ContainmentAction_tenantId_incidentId_state_idx" ON "ContainmentAction"("tenantId", "incidentId", "state");

-- AddForeignKey
ALTER TABLE "TraceShipmentLine" ADD CONSTRAINT "TraceShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "TraceShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainmentAction" ADD CONSTRAINT "ContainmentAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "QualityIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
