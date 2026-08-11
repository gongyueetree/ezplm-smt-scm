-- CreateEnum
CREATE TYPE "QuoteOutcome" AS ENUM ('OPEN', 'WON', 'LOST', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteTaskKind" AS ENUM ('MATERIAL', 'NRE', 'LABOR', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUBMITTED');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "customerOrderNo" TEXT,
ADD COLUMN     "outcome" "QuoteOutcome" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "outcomeAt" TIMESTAMP(3),
ADD COLUMN     "outcomeById" TEXT,
ADD COLUMN     "outcomeNote" TEXT;

-- CreateTable
CREATE TABLE "QuoteComponentTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "kind" "QuoteTaskKind" NOT NULL,
    "title" TEXT NOT NULL,
    "assignedRole" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "status" "QuoteTaskStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteComponentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NreItemDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultAmount" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NreItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteComponentTask_tenantId_quoteId_idx" ON "QuoteComponentTask"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "QuoteComponentTask_tenantId_status_idx" ON "QuoteComponentTask"("tenantId", "status");

-- CreateIndex
CREATE INDEX "NreItemDefinition_tenantId_active_idx" ON "NreItemDefinition"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "NreItemDefinition_tenantId_code_key" ON "NreItemDefinition"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Quote_tenantId_outcome_idx" ON "Quote"("tenantId", "outcome");

-- AddForeignKey
ALTER TABLE "QuoteComponentTask" ADD CONSTRAINT "QuoteComponentTask_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
