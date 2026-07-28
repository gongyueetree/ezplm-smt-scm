/**
 * 开发种子:1 租户(乾创电子)+ 五角色各 1 演示用户。
 * 密码:SEED_DEMO_PASSWORD 环境变量,缺省 demo1234(仅本地/预览;生产禁跑本种子)。
 * 所有写操作按纪律记 AuditLog(userId=管理层演示账号)。
 */
// 自足加载环境变量:不依赖 prisma.config.ts 的副作用(直接 tsx 运行也要能跑)
// .env.local 优先于 .env(与 Next.js 约定一致;dotenv 不覆盖已存在的变量)
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

import { PrismaClient, RoleName } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../lib/auth/password";
import { writeAudit } from "../lib/server/audit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL 未配置");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO_USERS: { email: string; name: string; role: RoleName }[] = [
  { email: "pm@demo.ezplm.cn", name: "王工(PM)", role: RoleName.PM },
  { email: "procurement@demo.ezplm.cn", name: "李采(采购)", role: RoleName.PROCUREMENT },
  { email: "engineering@demo.ezplm.cn", name: "张研(工程)", role: RoleName.ENGINEERING },
  { email: "management@demo.ezplm.cn", name: "赵总(管理层)", role: RoleName.MANAGEMENT },
  { email: "supplier@demo.ezplm.cn", name: "供方演示(供应商)", role: RoleName.SUPPLIER },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("演示种子禁止在 production 环境执行(演示口令仅限本地/预览)");
  }
  const password = process.env.SEED_DEMO_PASSWORD ?? "demo1234";
  const passwordHash = await hashPassword(password);

  const tenant = await prisma.tenant.upsert({
    where: { slug: "qianchuang" },
    update: {},
    create: { name: "乾创电子(苏州)", slug: "qianchuang" },
  });

  // 五角色目录
  const roles = new Map<RoleName, string>();
  for (const name of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name },
    });
    roles.set(name, role.id);
  }

  const created: string[] = [];
  for (const u of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: { name: u.name },
      create: {
        tenantId: tenant.id,
        email: u.email,
        name: u.name,
        passwordHash,
      },
    });
    await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: roles.get(u.role)!,
        },
      },
      update: {},
      create: { tenantId: tenant.id, userId: user.id, roleId: roles.get(u.role)! },
    });
    created.push(`${u.email} [${u.role}]`);
  }

  // 示例客户(联创科技等为示例数据中的下游客户)
  for (const c of [
    { code: "LC", name: "联创科技(深圳)" },
    { code: "HX", name: "宏兴电子" },
  ]) {
    await prisma.customer.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: { name: c.name },
      create: { tenantId: tenant.id, code: c.code, name: c.name },
    });
  }

  // 示例供应商(priority 越小越优先,参与 rankOffers)
  for (const s of [
    { code: "SUP-A", name: "华强北电子(示例)", priority: 10 },
    { code: "SUP-B", name: "深圳market代理(示例)", priority: 50 },
  ]) {
    await prisma.supplier.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: s.code } },
      update: { name: s.name, priority: s.priority },
      create: { tenantId: tenant.id, ...s, defaultCurrency: "CNY" },
    });
  }

  // 示例物料主数据(供 BOM 匹配演示;真实数据以 ezPLM 为唯一真源)
  const demoParts = [
    {
      internalPn: "QC-IC-0001",
      mpn: "STM32F103C8T6",
      manufacturer: "STMicroelectronics",
      description: "MCU ARM Cortex-M3 64KB Flash LQFP-48",
      footprint: "LQFP-48",
      lifecycle: "ACTIVE" as const,
    },
    {
      internalPn: "QC-RC-0104",
      mpn: "GRM188R71H104KA93D",
      manufacturer: "Murata",
      description: "CAP CER 0.1uF 50V X7R 0603",
      footprint: "0603",
      lifecycle: "ACTIVE" as const,
    },
    {
      internalPn: "QC-IC-0077",
      mpn: "MAX232CPE",
      manufacturer: "Analog Devices",
      description: "RS-232 收发器 DIP-16",
      footprint: "DIP-16",
      lifecycle: "EOL" as const,
    },
  ];
  for (const p of demoParts) {
    await prisma.part.upsert({
      where: { tenantId_internalPn: { tenantId: tenant.id, internalPn: p.internalPn } },
      update: {},
      create: { tenantId: tenant.id, ...p, syncedAt: new Date("2026-07-20T08:00:00Z") },
    });
  }

  await prisma.customerPartMapping.upsert({
    where: {
      tenantId_customerId_customerPn: {
        tenantId: tenant.id,
        customerId: "LC",
        customerPn: "LC-M-3201",
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      customerId: "LC",
      customerPn: "LC-M-3201",
      mpn: "STM32F103C8T6",
      manufacturer: "STMicroelectronics",
    },
  });

  // 示例 OPO 行(演示交期协同;真实数据由 ERP/采购订单同步产生)
  const supA = await prisma.supplier.findUniqueOrThrow({
    where: { tenantId_code: { tenantId: tenant.id, code: "SUP-A" } },
  });
  const day = 86_400_000;
  const opoSeed = [
    // 未回复 + ETA 在 3 天内 → 会进催办队列
    { poNo: "PO-2026-001", lineNo: 1, mpn: "STM32F103C8T6", qtyOrdered: 1000, qtyOpen: 1000, promiseIn: 3, needIn: 20 },
    // 承诺晚于需求 → error
    { poNo: "PO-2026-001", lineNo: 2, mpn: "GRM188R71H104KA93D", qtyOrdered: 5000, qtyOpen: 5000, promiseIn: 40, needIn: 20 },
    // 正常
    { poNo: "PO-2026-002", lineNo: 1, mpn: "RC0603FR-0710KL", qtyOrdered: 20000, qtyOpen: 8000, promiseIn: 10, needIn: 30 },
  ];
  // 演示回复重置:seed 是幂等的,回复若跨运行累积会让演示与 E2E 状态漂移
  const seededPoNos = [...new Set(opoSeed.map((o) => o.poNo))];
  const seededLines = await prisma.oPOLine.findMany({
    where: { tenantId: tenant.id, poNo: { in: seededPoNos } },
    select: { id: true },
  });
  if (seededLines.length > 0) {
    await prisma.oPOReply.deleteMany({
      where: { tenantId: tenant.id, opoLineId: { in: seededLines.map((l) => l.id) } },
    });
  }

  for (const o of opoSeed) {
    const now = Date.now();
    await prisma.oPOLine.upsert({
      where: { tenantId_poNo_lineNo: { tenantId: tenant.id, poNo: o.poNo, lineNo: o.lineNo } },
      update: {},
      create: {
        tenantId: tenant.id,
        poNo: o.poNo,
        lineNo: o.lineNo,
        supplierId: supA.id,
        mpn: o.mpn,
        qtyOrdered: o.qtyOrdered,
        qtyOpen: o.qtyOpen,
        currency: "CNY",
        promiseDate: new Date(now + o.promiseIn * day),
        needDate: new Date(now + o.needIn * day),
      },
    });
  }

  const admin = await prisma.user.findUniqueOrThrow({
    where: { tenantId_email: { tenantId: tenant.id, email: "management@demo.ezplm.cn" } },
  });
  await writeAudit(prisma, {
    tenantId: tenant.id,
    userId: admin.id,
    action: "SEED_DEMO_DATA",
    entityType: "Tenant",
    entityId: tenant.id,
    after: { users: created },
  });

  console.log(`seed 完成:租户 ${tenant.name}`);
  console.log(created.map((c) => `  - ${c}`).join("\n"));
  console.log(`演示密码:${password}(SEED_DEMO_PASSWORD 可覆盖)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
