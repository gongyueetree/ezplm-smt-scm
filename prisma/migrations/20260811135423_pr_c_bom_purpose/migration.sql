-- CreateEnum
CREATE TYPE "BOMPurpose" AS ENUM ('PRE_QUOTE', 'PRODUCTION');

-- AlterTable
ALTER TABLE "BOM" ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "convertedById" TEXT,
ADD COLUMN     "convertedFromBomId" TEXT,
ADD COLUMN     "purpose" "BOMPurpose" NOT NULL DEFAULT 'PRE_QUOTE';

-- AlterTable
ALTER TABLE "BOMLine" ADD COLUMN     "internalPartId" TEXT,
ADD COLUMN     "internalPn" TEXT,
ADD COLUMN     "internalPnNote" TEXT,
ADD COLUMN     "internalPnSource" TEXT;

-- CreateIndex
CREATE INDEX "BOM_tenantId_purpose_idx" ON "BOM"("tenantId", "purpose");

-- AddForeignKey
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_convertedFromBomId_fkey" FOREIGN KEY ("convertedFromBomId") REFERENCES "BOM"("id") ON DELETE SET NULL ON UPDATE CASCADE;
