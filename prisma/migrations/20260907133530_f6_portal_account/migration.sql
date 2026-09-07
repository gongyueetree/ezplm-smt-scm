-- CreateTable
CREATE TABLE "PortalAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "invitedById" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalAccount_tenantId_customerId_idx" ON "PortalAccount"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_tenantId_email_key" ON "PortalAccount"("tenantId", "email");
