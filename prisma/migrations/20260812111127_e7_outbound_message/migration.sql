-- CreateEnum
CREATE TYPE "OutboundMessageState" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'DELIVERY_FAILED');

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "state" "OutboundMessageState" NOT NULL DEFAULT 'DRAFT',
    "readReceiptRequested" BOOLEAN NOT NULL DEFAULT false,
    "readReceiptReceivedAt" TIMESTAMP(3),
    "openTrackedAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "providerMessageId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "field" TEXT NOT NULL DEFAULT 'TO',
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDeliveryEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundMessage_tenantId_kind_state_idx" ON "OutboundMessage"("tenantId", "kind", "state");

-- CreateIndex
CREATE INDEX "MessageRecipient_tenantId_messageId_idx" ON "MessageRecipient"("tenantId", "messageId");

-- CreateIndex
CREATE INDEX "MessageAttachment_tenantId_messageId_idx" ON "MessageAttachment"("tenantId", "messageId");

-- CreateIndex
CREATE INDEX "MessageDeliveryEvent_tenantId_messageId_idx" ON "MessageDeliveryEvent"("tenantId", "messageId");

-- AddForeignKey
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDeliveryEvent" ADD CONSTRAINT "MessageDeliveryEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboundMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
