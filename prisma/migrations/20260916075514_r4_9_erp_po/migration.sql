-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "erpCloseStatus" TEXT,
ADD COLUMN     "erpDocStatus" TEXT,
ADD COLUMN     "erpOrderDate" TIMESTAMP(3),
ADD COLUMN     "erpPoNumber" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "erpMaterialReceivedQty" DECIMAL(18,4),
ADD COLUMN     "erpReceivedQty" DECIMAL(18,4),
ADD COLUMN     "erpRemainingQty" DECIMAL(18,4),
ADD COLUMN     "isGift" BOOLEAN,
ADD COLUMN     "receiptDate" TIMESTAMP(3),
ADD COLUMN     "remark1" TEXT,
ADD COLUMN     "remark2" TEXT,
ADD COLUMN     "requestedDeliveryDate" TIMESTAMP(3),
ADD COLUMN     "sourceLineNo" INTEGER,
ADD COLUMN     "sourceRow" INTEGER,
ADD COLUMN     "supplierEtaDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_source_idx" ON "PurchaseOrder"("tenantId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_erpPoNumber_key" ON "PurchaseOrder"("tenantId", "erpPoNumber");

