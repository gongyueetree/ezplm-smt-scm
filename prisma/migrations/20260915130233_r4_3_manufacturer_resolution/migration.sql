-- CreateEnum
CREATE TYPE "ManufacturerAliasScope" AS ENUM ('GLOBAL', 'TENANT');

-- CreateEnum
CREATE TYPE "ManufacturerAliasSource" AS ENUM ('CURATED', 'MANUAL', 'MPN_EVIDENCE', 'IMPORT');

-- CreateEnum
CREATE TYPE "ManufacturerAliasStatus" AS ENUM ('APPROVED', 'CANDIDATE', 'REJECTED');

-- CreateTable
CREATE TABLE "CanonicalManufacturerRef" (
    "id" TEXT NOT NULL,
    "ezplmManufacturerId" TEXT,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "nameZh" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'CURATED',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalManufacturerRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturerAlias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "rawName" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "canonicalRefId" TEXT NOT NULL,
    "scope" "ManufacturerAliasScope" NOT NULL,
    "source" "ManufacturerAliasSource" NOT NULL,
    "status" "ManufacturerAliasStatus" NOT NULL DEFAULT 'CANDIDATE',
    "confidence" DECIMAL(4,3),
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalManufacturerRef_ezplmManufacturerId_key" ON "CanonicalManufacturerRef"("ezplmManufacturerId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalManufacturerRef_normalizedName_key" ON "CanonicalManufacturerRef"("normalizedName");

-- CreateIndex
CREATE INDEX "ManufacturerAlias_tenantId_status_idx" ON "ManufacturerAlias"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ManufacturerAlias_canonicalRefId_idx" ON "ManufacturerAlias"("canonicalRefId");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturerAlias_tenantId_normalizedAlias_key" ON "ManufacturerAlias"("tenantId", "normalizedAlias");

-- AddForeignKey
ALTER TABLE "ManufacturerAlias" ADD CONSTRAINT "ManufacturerAlias_canonicalRefId_fkey" FOREIGN KEY ("canonicalRefId") REFERENCES "CanonicalManufacturerRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R4-3 §14/§16:行业级 CURATED 引导名单(GLOBAL 别名,APPROVED)。
-- canonical 名与全球通行写法;ezplmManufacturerId 留空待对号;
-- 键规则与 lib/domain/part-mfg.ts mfgPartNoKey 一致(upper+去非字母数字)。
INSERT INTO "CanonicalManufacturerRef" ("id","canonicalName","normalizedName","nameZh","origin","createdAt","updatedAt")
VALUES
  ('cmr_ti','Texas Instruments','TEXASINSTRUMENTS','德州仪器','CURATED',now(),now()),
  ('cmr_st','STMicroelectronics','STMICROELECTRONICS','意法半导体','CURATED',now(),now()),
  ('cmr_murata','Murata','MURATA','村田','CURATED',now(),now()),
  ('cmr_yageo','YAGEO','YAGEO','国巨','CURATED',now(),now()),
  ('cmr_samsung','Samsung Electro-Mechanics','SAMSUNGELECTROMECHANICS','三星电机','CURATED',now(),now()),
  ('cmr_vishay','Vishay','VISHAY',NULL,'CURATED',now(),now()),
  ('cmr_onsemi','onsemi','ONSEMI','安森美','CURATED',now(),now()),
  ('cmr_nxp','NXP','NXP','恩智浦','CURATED',now(),now()),
  ('cmr_infineon','Infineon','INFINEON','英飞凌','CURATED',now(),now()),
  ('cmr_microchip','Microchip','MICROCHIP',NULL,'CURATED',now(),now()),
  ('cmr_adi','Analog Devices','ANALOGDEVICES','亚德诺','CURATED',now(),now()),
  ('cmr_tdk','TDK','TDK',NULL,'CURATED',now(),now()),
  ('cmr_kemet','KEMET','KEMET',NULL,'CURATED',now(),now()),
  ('cmr_panasonic','Panasonic','PANASONIC','松下','CURATED',now(),now()),
  ('cmr_rohm','ROHM','ROHM','罗姆','CURATED',now(),now()),
  ('cmr_nexperia','Nexperia','NEXPERIA','安世半导体','CURATED',now(),now()),
  ('cmr_espressif','Espressif','ESPRESSIF','乐鑫','CURATED',now(),now()),
  ('cmr_gigadevice','GigaDevice','GIGADEVICE','兆易创新','CURATED',now(),now()),
  ('cmr_sgmicro','SG Micro','SGMICRO','圣邦微','CURATED',now(),now()),
  ('cmr_wch','WCH','WCH','沁恒','CURATED',now(),now()),
  ('cmr_uni_royal','Uniroyal','UNIROYAL','厚声','CURATED',now(),now()),
  ('cmr_fenghua','FH (Guangdong Fenghua)','FHGUANGDONGFENGHUA','风华高科','CURATED',now(),now())
ON CONFLICT ("normalizedName") DO NOTHING;

INSERT INTO "ManufacturerAlias" ("id","tenantId","rawName","normalizedAlias","canonicalRefId","scope","source","status","confidence","createdAt","updatedAt")
VALUES
  ('ma_ti1','','TI','TI','cmr_ti','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_st1','','ST','ST','cmr_st','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_st2','','STM','STM','cmr_st','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_st3','','STMicro','STMICRO','cmr_st','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_adi1','','ADI','ADI','cmr_adi','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_murata1','','muRata','MURATA','cmr_murata','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_murata2','','村田','村田','cmr_murata','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_yageo1','','国巨','国巨','cmr_yageo','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_onsemi1','','ON Semiconductor','ONSEMICONDUCTOR','cmr_onsemi','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_sem1','','SEMCO','SEMCO','cmr_samsung','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_gd1','','兆易创新','兆易创新','cmr_gigadevice','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_sg1','','圣邦微','圣邦微','cmr_sgmicro','GLOBAL','CURATED','APPROVED',1.0,now(),now()),
  ('ma_fh1','','风华','风华','cmr_fenghua','GLOBAL','CURATED','APPROVED',1.0,now(),now())
ON CONFLICT ("tenantId","normalizedAlias") DO NOTHING;
