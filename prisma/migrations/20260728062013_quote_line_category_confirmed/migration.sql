-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "categoryConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "categoryConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "categoryConfirmedById" TEXT;
