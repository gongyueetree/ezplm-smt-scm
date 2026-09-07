-- CreateTable
CREATE TABLE "BomVersionManufacturingInfo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomVersionId" TEXT NOT NULL,
    "processRoute" JSONB,
    "panelization" JSONB,
    "stencil" JSONB,
    "tooling" JSONB,
    "note" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomVersionManufacturingInfo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BomVersionManufacturingInfo_tenantId_bomVersionId_key" ON "BomVersionManufacturingInfo"("tenantId", "bomVersionId");

-- AddForeignKey
ALTER TABLE "BomVersionManufacturingInfo" ADD CONSTRAINT "BomVersionManufacturingInfo_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "BOMVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
