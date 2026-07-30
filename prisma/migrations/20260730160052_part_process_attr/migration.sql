-- CreateTable
CREATE TABLE "PartProcessAttr" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "msl" TEXT,
    "packaging" TEXT,
    "reelQty" INTEGER,
    "note" TEXT,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartProcessAttr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartProcessAttr_partId_key" ON "PartProcessAttr"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "PartProcessAttr_tenantId_partId_key" ON "PartProcessAttr"("tenantId", "partId");

-- AddForeignKey
ALTER TABLE "PartProcessAttr" ADD CONSTRAINT "PartProcessAttr_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
