-- AlterTable
ALTER TABLE "BOMImportJob" ADD COLUMN     "rawRowCount" INTEGER,
ADD COLUMN     "reconciliation" JSONB;

-- CreateTable
CREATE TABLE "RawBomRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "cells" JSONB NOT NULL,
    "disposition" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "lineNo" INTEGER,
    "mergedIntoSourceRow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawBomRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawBomRow_tenantId_importJobId_disposition_idx" ON "RawBomRow"("tenantId", "importJobId", "disposition");

-- CreateIndex
CREATE UNIQUE INDEX "RawBomRow_tenantId_importJobId_sourceRow_key" ON "RawBomRow"("tenantId", "importJobId", "sourceRow");

-- AddForeignKey
ALTER TABLE "RawBomRow" ADD CONSTRAINT "RawBomRow_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "BOMImportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
