-- E2:替代料三维兼容性(客户 Q10)。
-- updatedAt 带 DEFAULT CURRENT_TIMESTAMP —— PartAlternate 生产库里已有数据,
-- 不带默认值的 NOT NULL 列会让迁移在客户环境直接失败。
-- CreateEnum
CREATE TYPE "FunctionalEquivalence" AS ENUM ('EXACT', 'EQUIVALENT', 'PARTIAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PackageCompatibility" AS ENUM ('EXACT', 'MINOR_VARIATION', 'DIFFERENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PinCompatibility" AS ENUM ('PIN_TO_PIN', 'REQUIRES_REVIEW', 'NOT_COMPATIBLE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "PartAlternate" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "evidenceSource" TEXT,
ADD COLUMN     "functionalEquivalence" "FunctionalEquivalence" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "packageCompatibility" "PackageCompatibility" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "pinCompatibility" "PinCompatibility" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "PartAlternate_tenantId_functionalEquivalence_idx" ON "PartAlternate"("tenantId", "functionalEquivalence");
