-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "categoryL1" TEXT,
ADD COLUMN     "categoryL2" TEXT;

-- CreateTable
CREATE TABLE "PartTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartTagLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartTagLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomCompareRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromVersionId" TEXT NOT NULL,
    "toVersionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addedCount" INTEGER NOT NULL,
    "removedCount" INTEGER NOT NULL,
    "qtyChangedCount" INTEGER NOT NULL,
    "partChangedCount" INTEGER NOT NULL,
    "unchangedCount" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BomCompareRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartTag_tenantId_name_key" ON "PartTag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PartTagLink_tenantId_tagId_idx" ON "PartTagLink"("tenantId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "PartTagLink_tenantId_partId_tagId_key" ON "PartTagLink"("tenantId", "partId", "tagId");

-- CreateIndex
CREATE INDEX "BomCompareRun_tenantId_createdAt_idx" ON "BomCompareRun"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "BomCompareRun_tenantId_fromVersionId_toVersionId_idx" ON "BomCompareRun"("tenantId", "fromVersionId", "toVersionId");

-- CreateIndex
CREATE INDEX "Part_tenantId_categoryL1_categoryL2_idx" ON "Part"("tenantId", "categoryL1", "categoryL2");

-- AddForeignKey
ALTER TABLE "PartTagLink" ADD CONSTRAINT "PartTagLink_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartTagLink" ADD CONSTRAINT "PartTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PartTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
