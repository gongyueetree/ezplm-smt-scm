-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('PM', 'PROCUREMENT', 'ENGINEERING', 'MANAGEMENT', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'RECEIVED', 'PARSING', 'WAITING_ENGINEERING', 'WAITING_PROCUREMENT', 'QUOTING', 'PENDING_APPROVAL', 'QUOTED', 'CLOSED_NO_QUOTE', 'LOST');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteCostCategory" AS ENUM ('MATERIAL', 'LABOR', 'NRE', 'SMT', 'DIP', 'TEST', 'OVERHEAD', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('BOM', 'GERBER', 'PDF', 'IMAGE', 'PROCESS_DOC', 'OTHER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('ACTIVE', 'NRND', 'EOL', 'OBSOLETE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('EZPLM', 'DIGIKEY', 'MOUSER', 'OFFLINE');

-- CreateEnum
CREATE TYPE "MatchSource" AS ENUM ('CUSTOMER_MAPPING', 'INTERNAL_PN', 'EXACT_MPN', 'MFR_MPN', 'DESCRIPTION', 'EZPLM', 'DIGIKEY', 'MOUSER', 'MANUAL');

-- CreateEnum
CREATE TYPE "LineDecisionType" AS ENUM ('ACCEPT_CANDIDATE', 'MANUAL_ASSIGN', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProcurementRfqStatus" AS ENUM ('DRAFT', 'SOURCING', 'FEEDBACK_READY', 'CLOSED');

-- CreateEnum
CREATE TYPE "SourcingMode" AS ENUM ('SPOT', 'FUTURES');

-- CreateEnum
CREATE TYPE "FlagResolution" AS ENUM ('ACCEPT', 'REQUOTE', 'SWITCH_SOURCE', 'ADJUST_PRICE');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PROCESSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReplySource" AS ENUM ('EMAIL', 'PORTAL', 'EXCEL', 'PHONE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('RFQ_INTAKE', 'BOM_MATCHING', 'SOURCING', 'QUOTE', 'OPO');

-- CreateEnum
CREATE TYPE "IntegrationJobType" AS ENUM ('ERP_ORDER_EXPORT', 'ERP_ETA_WRITEBACK', 'EMAIL_SEND', 'OPO_REMINDER', 'OTHER');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ezplmTenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "externalUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQ" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteQtys" JSONB,
    "dueAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RFQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "contentType" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RFQAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQStatusHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "fromStatus" "RfqStatus",
    "toStatus" "RfqStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RFQStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOM" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rfqId" TEXT,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BOM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOMVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "sourceFileKey" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BOMVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOMLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomVersionId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "refDes" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "customerPn" TEXT,
    "mpn" TEXT,
    "manufacturer" TEXT,
    "description" TEXT,
    "footprint" TEXT,
    "dupRefDesFlag" BOOLEAN NOT NULL DEFAULT false,
    "eolFlag" BOOLEAN NOT NULL DEFAULT false,
    "footprintMismatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BOMLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOMImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomId" TEXT,
    "rfqId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "fileKeys" JSONB,
    "totalLines" INTEGER NOT NULL DEFAULT 0,
    "processedLines" INTEGER NOT NULL DEFAULT 0,
    "batchSize" INTEGER NOT NULL DEFAULT 20,
    "columnMapping" JSONB,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BOMImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "internalPn" TEXT NOT NULL,
    "mpn" TEXT,
    "manufacturer" TEXT,
    "description" TEXT,
    "footprint" TEXT,
    "lifecycle" "Lifecycle" NOT NULL DEFAULT 'UNKNOWN',
    "dateCode" TEXT,
    "msl" TEXT,
    "packaging" TEXT,
    "rohs" BOOLEAN,
    "reach" BOOLEAN,
    "sourcedFrom" "ProviderType" NOT NULL DEFAULT 'EZPLM',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartIdentifier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPartMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerPn" TEXT NOT NULL,
    "partId" TEXT,
    "mpn" TEXT,
    "manufacturer" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPartMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartAlternate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "alternatePartId" TEXT NOT NULL,
    "grade" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartAlternate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qtyOnHand" DECIMAL(18,4) NOT NULL,
    "qtySlowMoving" DECIMAL(18,4),
    "warehouse" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenPOLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "qtyOpen" DECIMAL(18,4) NOT NULL,
    "eta" TIMESTAMP(3),
    "supplierId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenPOLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomMatchCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomLineId" TEXT NOT NULL,
    "source" "MatchSource" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "partId" TEXT,
    "mpn" TEXT NOT NULL,
    "manufacturer" TEXT,
    "footprint" TEXT,
    "lifecycle" "Lifecycle",
    "stockQty" DECIMAL(18,4),
    "slowMovingQty" DECIMAL(18,4),
    "opoQty" DECIMAL(18,4),
    "eta" TIMESTAMP(3),
    "price" DECIMAL(18,6),
    "currency" TEXT,
    "alternates" JSONB,
    "dataUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BomMatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLineDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomLineId" TEXT NOT NULL,
    "candidateId" TEXT,
    "partId" TEXT,
    "decision" "LineDecisionType" NOT NULL,
    "note" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BomLineDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPartSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "ProviderType" NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "ttlSeconds" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalPartSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "ProviderType" NOT NULL,
    "supplierId" TEXT,
    "partId" TEXT,
    "providerPartNumber" TEXT,
    "mpn" TEXT NOT NULL,
    "manufacturer" TEXT,
    "description" TEXT,
    "packaging" TEXT,
    "stock" DECIMAL(18,4),
    "moq" DECIMAL(18,4),
    "spq" DECIMAL(18,4),
    "leadTimeDays" INTEGER,
    "lifecycle" "Lifecycle",
    "rohs" BOOLEAN,
    "reach" BOOLEAN,
    "currency" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBreak" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierOfferId" TEXT NOT NULL,
    "minQty" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "PriceBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "laborRateTemplate" JSONB,
    "submittedSnapshot" JSONB,
    "approvedSnapshot" JSONB,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "category" "QuoteCostCategory" NOT NULL,
    "bomLineId" TEXT,
    "quotedMfg" TEXT,
    "quotedMpn" TEXT,
    "materialCategory" TEXT,
    "altMfg" TEXT,
    "altMpn" TEXT,
    "qty" DECIMAL(18,4),
    "purchaseCost" DECIMAL(18,6),
    "markupPct" DECIMAL(9,6),
    "finalUnitPrice" DECIMAL(18,6),
    "customerPrice" DECIMAL(18,6),
    "ppv" DECIMAL(18,6),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementRFQ" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rfqId" TEXT,
    "bomVersionIds" JSONB,
    "status" "ProcurementRfqStatus" NOT NULL DEFAULT 'DRAFT',
    "sourcingMode" "SourcingMode" NOT NULL DEFAULT 'SPOT',
    "feedbackNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementRFQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procurementRfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "provider" "ProviderType" NOT NULL DEFAULT 'OFFLINE',
    "currency" TEXT NOT NULL,
    "sourceFileKey" TEXT,
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuoteLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierQuoteId" TEXT NOT NULL,
    "bomLineId" TEXT,
    "partId" TEXT,
    "mpn" TEXT NOT NULL,
    "manufacturer" TEXT,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "moq" DECIMAL(18,4),
    "spq" DECIMAL(18,4),
    "leadTimeDays" INTEGER,
    "sourcingMode" "SourcingMode" NOT NULL DEFAULT 'SPOT',
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "wasFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReasons" JSONB,
    "resolution" "FlagResolution",
    "resolutionNote" TEXT,
    "previousLineId" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "selectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "bomVersionId" TEXT,
    "partId" TEXT,
    "mpn" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "gtbSnapshot" JSONB,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OPOLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "supplierId" TEXT NOT NULL,
    "partId" TEXT,
    "mpn" TEXT,
    "qtyOrdered" DECIMAL(18,4) NOT NULL,
    "qtyOpen" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,6),
    "currency" TEXT,
    "promiseDate" TIMESTAMP(3),
    "needDate" TIMESTAMP(3),
    "nextReminderAt" TIMESTAMP(3),
    "erpRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OPOLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OPOReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opoLineId" TEXT NOT NULL,
    "replyEta" TIMESTAMP(3),
    "replyQty" DECIMAL(18,4),
    "replyNote" TEXT,
    "replyAt" TIMESTAMP(3) NOT NULL,
    "replySource" "ReplySource" NOT NULL,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OPOReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opoLineId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "userId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "writtenRefs" JSONB,
    "error" TEXT,
    "tokenUsage" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "toolName" TEXT,
    "input" JSONB,
    "output" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "stepId" TEXT,
    "source" "ProviderType",
    "uri" TEXT,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "stepId" TEXT,
    "toolName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "IntegrationJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "ProviderType" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER,
    "rateLimitLimit" INTEGER,
    "rateLimitRemaining" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "User_tenantId_externalUserId_idx" ON "User"("tenantId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_name_key" ON "Role"("tenantId", "name");

-- CreateIndex
CREATE INDEX "UserRole_tenantId_userId_idx" ON "UserRole"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_tenantId_userId_roleId_key" ON "UserRole"("tenantId", "userId", "roleId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_name_idx" ON "Customer"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_code_key" ON "Customer"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_name_idx" ON "Supplier"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_code_key" ON "Supplier"("tenantId", "code");

-- CreateIndex
CREATE INDEX "SupplierContact_tenantId_supplierId_idx" ON "SupplierContact"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "RFQ_tenantId_status_idx" ON "RFQ"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RFQ_tenantId_customerId_idx" ON "RFQ"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "RFQ_tenantId_code_key" ON "RFQ"("tenantId", "code");

-- CreateIndex
CREATE INDEX "RFQAttachment_tenantId_rfqId_idx" ON "RFQAttachment"("tenantId", "rfqId");

-- CreateIndex
CREATE INDEX "RFQStatusHistory_tenantId_rfqId_createdAt_idx" ON "RFQStatusHistory"("tenantId", "rfqId", "createdAt");

-- CreateIndex
CREATE INDEX "BOM_tenantId_rfqId_idx" ON "BOM"("tenantId", "rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "BOMVersion_tenantId_bomId_versionNo_key" ON "BOMVersion"("tenantId", "bomId", "versionNo");

-- CreateIndex
CREATE INDEX "BOMLine_tenantId_mpn_idx" ON "BOMLine"("tenantId", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "BOMLine_tenantId_bomVersionId_lineNo_key" ON "BOMLine"("tenantId", "bomVersionId", "lineNo");

-- CreateIndex
CREATE INDEX "BOMImportJob_tenantId_status_idx" ON "BOMImportJob"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BOMImportJob_tenantId_idempotencyKey_key" ON "BOMImportJob"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Part_tenantId_mpn_idx" ON "Part"("tenantId", "mpn");

-- CreateIndex
CREATE INDEX "Part_tenantId_manufacturer_mpn_idx" ON "Part"("tenantId", "manufacturer", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "Part_tenantId_internalPn_key" ON "Part"("tenantId", "internalPn");

-- CreateIndex
CREATE INDEX "PartIdentifier_tenantId_value_idx" ON "PartIdentifier"("tenantId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "PartIdentifier_tenantId_type_value_partId_key" ON "PartIdentifier"("tenantId", "type", "value", "partId");

-- CreateIndex
CREATE INDEX "CustomerPartMapping_tenantId_partId_idx" ON "CustomerPartMapping"("tenantId", "partId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPartMapping_tenantId_customerId_customerPn_key" ON "CustomerPartMapping"("tenantId", "customerId", "customerPn");

-- CreateIndex
CREATE UNIQUE INDEX "PartAlternate_tenantId_partId_alternatePartId_key" ON "PartAlternate"("tenantId", "partId", "alternatePartId");

-- CreateIndex
CREATE INDEX "InventorySnapshot_tenantId_partId_fetchedAt_idx" ON "InventorySnapshot"("tenantId", "partId", "fetchedAt");

-- CreateIndex
CREATE INDEX "OpenPOLine_tenantId_partId_idx" ON "OpenPOLine"("tenantId", "partId");

-- CreateIndex
CREATE INDEX "BomMatchCandidate_tenantId_bomLineId_idx" ON "BomMatchCandidate"("tenantId", "bomLineId");

-- CreateIndex
CREATE UNIQUE INDEX "BomLineDecision_tenantId_bomLineId_key" ON "BomLineDecision"("tenantId", "bomLineId");

-- CreateIndex
CREATE INDEX "ExternalPartSnapshot_tenantId_expiresAt_idx" ON "ExternalPartSnapshot"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPartSnapshot_tenantId_source_cacheKey_key" ON "ExternalPartSnapshot"("tenantId", "source", "cacheKey");

-- CreateIndex
CREATE INDEX "SupplierOffer_tenantId_mpn_idx" ON "SupplierOffer"("tenantId", "mpn");

-- CreateIndex
CREATE INDEX "SupplierOffer_tenantId_provider_mpn_idx" ON "SupplierOffer"("tenantId", "provider", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBreak_tenantId_supplierOfferId_minQty_key" ON "PriceBreak"("tenantId", "supplierOfferId", "minQty");

-- CreateIndex
CREATE INDEX "Quote_tenantId_rfqId_idx" ON "Quote"("tenantId", "rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_tenantId_code_key" ON "Quote"("tenantId", "code");

-- CreateIndex
CREATE INDEX "QuoteVersion_tenantId_status_idx" ON "QuoteVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_tenantId_quoteId_revision_key" ON "QuoteVersion"("tenantId", "quoteId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_tenantId_quoteVersionId_lineNo_key" ON "QuoteLine"("tenantId", "quoteVersionId", "lineNo");

-- CreateIndex
CREATE INDEX "QuoteApproval_tenantId_quoteVersionId_idx" ON "QuoteApproval"("tenantId", "quoteVersionId");

-- CreateIndex
CREATE INDEX "ProcurementRFQ_tenantId_status_idx" ON "ProcurementRFQ"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementRFQ_tenantId_code_key" ON "ProcurementRFQ"("tenantId", "code");

-- CreateIndex
CREATE INDEX "SupplierQuote_tenantId_procurementRfqId_idx" ON "SupplierQuote"("tenantId", "procurementRfqId");

-- CreateIndex
CREATE INDEX "SupplierQuoteLine_tenantId_supplierQuoteId_idx" ON "SupplierQuoteLine"("tenantId", "supplierQuoteId");

-- CreateIndex
CREATE INDEX "SupplierQuoteLine_tenantId_bomLineId_idx" ON "SupplierQuoteLine"("tenantId", "bomLineId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_tenantId_status_idx" ON "PurchaseRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_tenantId_mpn_idx" ON "PurchaseRequest"("tenantId", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_tenantId_code_key" ON "PurchaseRequest"("tenantId", "code");

-- CreateIndex
CREATE INDEX "OPOLine_tenantId_supplierId_idx" ON "OPOLine"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "OPOLine_tenantId_nextReminderAt_idx" ON "OPOLine"("tenantId", "nextReminderAt");

-- CreateIndex
CREATE UNIQUE INDEX "OPOLine_tenantId_poNo_lineNo_key" ON "OPOLine"("tenantId", "poNo", "lineNo");

-- CreateIndex
CREATE INDEX "OPOReply_tenantId_opoLineId_replyAt_idx" ON "OPOReply"("tenantId", "opoLineId", "replyAt");

-- CreateIndex
CREATE INDEX "ReminderLog_tenantId_opoLineId_idx" ON "ReminderLog"("tenantId", "opoLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_tenantId_idempotencyKey_key" ON "ReminderLog"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_agentType_createdAt_idx" ON "AgentRun"("tenantId", "agentType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_tenantId_idempotencyKey_key" ON "AgentRun"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_tenantId_agentRunId_stepNo_key" ON "AgentStep"("tenantId", "agentRunId", "stepNo");

-- CreateIndex
CREATE INDEX "AgentEvidence_tenantId_agentRunId_idx" ON "AgentEvidence"("tenantId", "agentRunId");

-- CreateIndex
CREATE INDEX "AgentApproval_tenantId_agentRunId_idx" ON "AgentApproval"("tenantId", "agentRunId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_userId_createdAt_idx" ON "AuditLog"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationJob_tenantId_status_nextRetryAt_idx" ON "IntegrationJob"("tenantId", "status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationJob_tenantId_idempotencyKey_key" ON "IntegrationJob"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApiUsageLog_tenantId_provider_createdAt_idx" ON "ApiUsageLog"("tenantId", "provider", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQAttachment" ADD CONSTRAINT "RFQAttachment_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQStatusHistory" ADD CONSTRAINT "RFQStatusHistory_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMVersion" ADD CONSTRAINT "BOMVersion_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMLine" ADD CONSTRAINT "BOMLine_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "BOMVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartIdentifier" ADD CONSTRAINT "PartIdentifier_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartAlternate" ADD CONSTRAINT "PartAlternate_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartAlternate" ADD CONSTRAINT "PartAlternate_alternatePartId_fkey" FOREIGN KEY ("alternatePartId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomMatchCandidate" ADD CONSTRAINT "BomMatchCandidate_bomLineId_fkey" FOREIGN KEY ("bomLineId") REFERENCES "BOMLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLineDecision" ADD CONSTRAINT "BomLineDecision_bomLineId_fkey" FOREIGN KEY ("bomLineId") REFERENCES "BOMLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBreak" ADD CONSTRAINT "PriceBreak_supplierOfferId_fkey" FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteApproval" ADD CONSTRAINT "QuoteApproval_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_procurementRfqId_fkey" FOREIGN KEY ("procurementRfqId") REFERENCES "ProcurementRFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuoteLine" ADD CONSTRAINT "SupplierQuoteLine_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "SupplierQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OPOReply" ADD CONSTRAINT "OPOReply_opoLineId_fkey" FOREIGN KEY ("opoLineId") REFERENCES "OPOLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
