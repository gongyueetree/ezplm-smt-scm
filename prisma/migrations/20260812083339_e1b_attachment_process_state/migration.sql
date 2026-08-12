-- AlterTable
ALTER TABLE "RFQAttachment" ADD COLUMN     "processNote" TEXT,
ADD COLUMN     "processState" TEXT NOT NULL DEFAULT 'UPLOADED_NOT_PARSED';
