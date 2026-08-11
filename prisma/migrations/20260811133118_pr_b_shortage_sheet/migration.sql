-- CreateEnum
CREATE TYPE "ShortageSheetSource" AS ENUM ('EXCEL_IMPORT', 'ERP', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShortageLineStatus" AS ENUM ('OPEN', 'CALL_CREATED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RESOLVED', 'RESOLVED');

-- CreateTable
CREATE TABLE "ShortageSheet" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" "ShortageSheetSource" NOT NULL,
    "sheetDate" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortageSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortageSheetLine" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "customerId" TEXT,
    "internalPn" TEXT,
    "manufacturer" TEXT,
    "mpn" TEXT,
    "requiredQty" DECIMAL(18,4) NOT NULL,
    "availableInventory" DECIMAL(18,4),
    "openPoQty" DECIMAL(18,4),
    "eta" TIMESTAMP(3),
    "supplierId" TEXT,
    "shortageQty" DECIMAL(18,4) NOT NULL,
    "callQty" DECIMAL(18,4),
    "requiredDate" TIMESTAMP(3),
    "status" "ShortageLineStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortageSheetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallMaterialRecord" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "supplierId" TEXT,
    "callQty" DECIMAL(18,4) NOT NULL,
    "emailState" TEXT NOT NULL DEFAULT 'DRAFT',
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "toEmails" TEXT[],
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallMaterialRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShortageSheet_tenantId_sheetDate_idx" ON "ShortageSheet"("tenantId", "sheetDate");

-- CreateIndex
CREATE UNIQUE INDEX "ShortageSheet_tenantId_code_key" ON "ShortageSheet"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ShortageSheetLine_tenantId_status_idx" ON "ShortageSheetLine"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ShortageSheetLine_tenantId_mpn_idx" ON "ShortageSheetLine"("tenantId", "mpn");

-- CreateIndex
CREATE INDEX "CallMaterialRecord_tenantId_lineId_idx" ON "CallMaterialRecord"("tenantId", "lineId");

-- AddForeignKey
ALTER TABLE "ShortageSheetLine" ADD CONSTRAINT "ShortageSheetLine_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ShortageSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallMaterialRecord" ADD CONSTRAINT "CallMaterialRecord_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ShortageSheetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
