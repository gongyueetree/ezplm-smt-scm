-- CreateEnum
CREATE TYPE "ErpVendor" AS ENUM ('KINGDEE', 'YONYOU', 'SAP', 'ORACLE', 'EXCEL', 'MOCK');

-- CreateEnum
CREATE TYPE "ErpConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING_TEST', 'CONNECTED', 'DEGRADED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ErpSyncDirection" AS ENUM ('ERP_TO_EZPLM', 'EZPLM_TO_ERP', 'BIDIRECTIONAL', 'IMPORT_ONLY', 'EXPORT_TEMPLATE_ONLY');

-- CreateEnum
CREATE TYPE "ErpEntityType" AS ENUM ('MATERIAL', 'INVENTORY', 'OPEN_PO', 'WORK_ORDER', 'PURCHASE_ORDER', 'ETA_WRITEBACK', 'RECEIPT_LOT', 'SHIPMENT');

-- CreateEnum
CREATE TYPE "ErpConflictPolicy" AS ENUM ('STOP_ON_CONFLICT', 'SKIP_ON_CONFLICT', 'QUEUE_FOR_HUMAN');

-- CreateEnum
CREATE TYPE "ErpLineOutcome" AS ENUM ('CREATED', 'UPDATED', 'UNCHANGED', 'CONFLICT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "ErpConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" "ErpVendor" NOT NULL,
    "edition" TEXT,
    "config" JSONB NOT NULL,
    "status" "ErpConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastTestAt" TIMESTAMP(3),
    "lastTestResult" JSONB,
    "syncCron" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "cipherText" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "maskedHint" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpFieldMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "entityType" "ErpEntityType" NOT NULL,
    "erpField" TEXT NOT NULL,
    "localField" TEXT NOT NULL,
    "transform" TEXT,
    "defaultValue" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sampleResult" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpFieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSyncPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "entityType" "ErpEntityType" NOT NULL,
    "direction" "ErpSyncDirection" NOT NULL DEFAULT 'IMPORT_ONLY',
    "conflictPolicy" "ErpConflictPolicy" NOT NULL DEFAULT 'QUEUE_FOR_HUMAN',
    "incrementalField" TEXT,
    "lastCursor" TEXT,
    "requirePreview" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpSyncPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "entityType" "ErpEntityType" NOT NULL,
    "direction" "ErpSyncDirection" NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PREVIEW',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "externalJobId" TEXT,
    "requestId" TEXT,
    "errorSummary" TEXT,
    "triggeredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSyncJobLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "bizKey" TEXT NOT NULL,
    "outcome" "ErpLineOutcome" NOT NULL,
    "erpValues" JSONB,
    "localValues" JSONB,
    "changedFields" JSONB,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpSyncJobLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpConflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "entityType" "ErpEntityType" NOT NULL,
    "bizKey" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "erpValue" TEXT,
    "localValue" TEXT,
    "resolution" TEXT,
    "manualValue" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "externalId" TEXT,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErpConnection_tenantId_vendor_status_idx" ON "ErpConnection"("tenantId", "vendor", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErpConnection_tenantId_name_key" ON "ErpConnection"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ErpCredential_tenantId_connectionId_field_key" ON "ErpCredential"("tenantId", "connectionId", "field");

-- CreateIndex
CREATE INDEX "ErpFieldMapping_tenantId_connectionId_entityType_idx" ON "ErpFieldMapping"("tenantId", "connectionId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "ErpFieldMapping_tenantId_connectionId_entityType_localField_key" ON "ErpFieldMapping"("tenantId", "connectionId", "entityType", "localField");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSyncPolicy_tenantId_connectionId_entityType_key" ON "ErpSyncPolicy"("tenantId", "connectionId", "entityType");

-- CreateIndex
CREATE INDEX "ErpSyncJob_tenantId_connectionId_entityType_createdAt_idx" ON "ErpSyncJob"("tenantId", "connectionId", "entityType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSyncJob_tenantId_idempotencyKey_key" ON "ErpSyncJob"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ErpSyncJobLine_tenantId_jobId_outcome_idx" ON "ErpSyncJobLine"("tenantId", "jobId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "ErpSyncJobLine_tenantId_jobId_lineNo_key" ON "ErpSyncJobLine"("tenantId", "jobId", "lineNo");

-- CreateIndex
CREATE INDEX "ErpConflict_tenantId_jobId_resolution_idx" ON "ErpConflict"("tenantId", "jobId", "resolution");

-- CreateIndex
CREATE INDEX "ErpConflict_tenantId_entityType_bizKey_idx" ON "ErpConflict"("tenantId", "entityType", "bizKey");

-- CreateIndex
CREATE INDEX "ErpWebhookEvent_tenantId_processedAt_idx" ON "ErpWebhookEvent"("tenantId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErpWebhookEvent_tenantId_connectionId_externalId_key" ON "ErpWebhookEvent"("tenantId", "connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "ErpCredential" ADD CONSTRAINT "ErpCredential_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpFieldMapping" ADD CONSTRAINT "ErpFieldMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncPolicy" ADD CONSTRAINT "ErpSyncPolicy_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ErpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJobLine" ADD CONSTRAINT "ErpSyncJobLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ErpSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpConflict" ADD CONSTRAINT "ErpConflict_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ErpSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
