-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "toName" TEXT,
    "toEmail" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "previewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOnboardInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT,
    "token" TEXT NOT NULL,
    "toEmail" TEXT,
    "companyName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submitted" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOnboardInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoAcknowledgement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'EMAIL_MANUAL',
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailDraft_tenantId_kind_status_idx" ON "EmailDraft"("tenantId", "kind", "status");

-- CreateIndex
CREATE INDEX "EmailDraft_tenantId_refType_refId_idx" ON "EmailDraft"("tenantId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOnboardInvite_token_key" ON "SupplierOnboardInvite"("token");

-- CreateIndex
CREATE INDEX "SupplierOnboardInvite_tenantId_status_idx" ON "SupplierOnboardInvite"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PoAcknowledgement_tenantId_poNo_idx" ON "PoAcknowledgement"("tenantId", "poNo");

-- CreateIndex
CREATE UNIQUE INDEX "PoAcknowledgement_tenantId_poNo_supplierId_key" ON "PoAcknowledgement"("tenantId", "poNo", "supplierId");
