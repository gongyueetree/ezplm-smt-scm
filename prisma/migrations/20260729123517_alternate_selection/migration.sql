-- CreateTable
CREATE TABLE "AlternateSelection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mpn" TEXT NOT NULL,
    "alternateMpn" TEXT NOT NULL,
    "manufacturer" TEXT,
    "mode" TEXT NOT NULL,
    "technical" INTEGER NOT NULL,
    "evidence" INTEGER NOT NULL,
    "sourceTrust" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "reasons" JSONB,
    "warnings" JSONB,
    "market" JSONB,
    "note" TEXT,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlternateSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlternateSelection_tenantId_mpn_idx" ON "AlternateSelection"("tenantId", "mpn");

-- CreateIndex
CREATE UNIQUE INDEX "AlternateSelection_tenantId_mpn_alternateMpn_key" ON "AlternateSelection"("tenantId", "mpn", "alternateMpn");
