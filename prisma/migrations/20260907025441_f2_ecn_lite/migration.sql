-- CreateEnum
CREATE TYPE "EcnStatus" AS ENUM ('DRAFT', 'REVIEW', 'CUSTOMER_CONFIRM', 'APPROVED', 'RELEASED', 'CLOSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "EcnType" AS ENUM ('DESIGN_CHANGE', 'EOL_REPLACEMENT', 'PROCESS_CHANGE', 'DOC_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "EcnPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "EcnStage" AS ENUM ('ENGINEERING', 'PROCUREMENT', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "EcnEffectiveStrategy" AS ENUM ('IMMEDIATE', 'AFTER_WORK_ORDERS', 'ON_DATE');

-- AlterTable
ALTER TABLE "BOMVersion" ADD COLUMN     "ecnId" TEXT;

-- CreateTable
CREATE TABLE "Ecn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "EcnType" NOT NULL,
    "priority" "EcnPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "EcnStatus" NOT NULL DEFAULT 'DRAFT',
    "customerId" TEXT,
    "productName" TEXT,
    "reason" TEXT,
    "effectiveStrategy" "EcnEffectiveStrategy",
    "effectiveAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "releasedSnapshot" JSONB,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ecn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcnChangeLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ecnId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "bomId" TEXT,
    "bomVersionId" TEXT,
    "oldInternalPn" TEXT,
    "oldMpn" TEXT,
    "newInternalPn" TEXT,
    "newMpn" TEXT,
    "qtyImpact" DECIMAL(18,4),
    "reason" TEXT,
    "engineeringNote" TEXT,
    "procurementNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcnChangeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcnApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ecnId" TEXT NOT NULL,
    "stage" "EcnStage" NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcnApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcnCustomerNotice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ecnId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "contractNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "expectedReplyAt" TIMESTAMP(3),
    "outboundMessageId" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcnCustomerNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ecn_tenantId_status_priority_idx" ON "Ecn"("tenantId", "status", "priority");

-- CreateIndex
CREATE INDEX "Ecn_tenantId_customerId_idx" ON "Ecn"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Ecn_tenantId_code_key" ON "Ecn"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EcnChangeLine_tenantId_ecnId_lineNo_key" ON "EcnChangeLine"("tenantId", "ecnId", "lineNo");

-- CreateIndex
CREATE INDEX "EcnApproval_tenantId_ecnId_decidedAt_idx" ON "EcnApproval"("tenantId", "ecnId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EcnCustomerNotice_tenantId_ecnId_customerId_key" ON "EcnCustomerNotice"("tenantId", "ecnId", "customerId");

-- AddForeignKey
ALTER TABLE "EcnChangeLine" ADD CONSTRAINT "EcnChangeLine_ecnId_fkey" FOREIGN KEY ("ecnId") REFERENCES "Ecn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcnApproval" ADD CONSTRAINT "EcnApproval_ecnId_fkey" FOREIGN KEY ("ecnId") REFERENCES "Ecn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcnCustomerNotice" ADD CONSTRAINT "EcnCustomerNotice_ecnId_fkey" FOREIGN KEY ("ecnId") REFERENCES "Ecn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
