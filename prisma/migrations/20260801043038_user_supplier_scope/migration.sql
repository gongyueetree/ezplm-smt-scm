-- AlterTable
ALTER TABLE "User" ADD COLUMN     "supplierId" TEXT;

-- CreateIndex
CREATE INDEX "User_tenantId_supplierId_idx" ON "User"("tenantId", "supplierId");
