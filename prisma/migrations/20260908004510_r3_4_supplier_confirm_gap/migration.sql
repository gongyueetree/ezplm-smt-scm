-- AlterTable
ALTER TABLE "CallMaterialRecord" ADD COLUMN     "replyAt" TIMESTAMP(3),
ADD COLUMN     "replyCanSupply" BOOLEAN,
ADD COLUMN     "replyEta" TIMESTAMP(3),
ADD COLUMN     "replyNote" TEXT,
ADD COLUMN     "replyQty" DECIMAL(18,4),
ADD COLUMN     "replySource" TEXT;

-- AlterTable
ALTER TABLE "SupplierOffer" ADD COLUMN     "supplierNote" TEXT,
ADD COLUMN     "validUntil" TIMESTAMP(3);
