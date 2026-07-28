/**
 * 开发种子:1 租户(乾创电子)+ 五角色各 1 演示用户。
 * 密码:SEED_DEMO_PASSWORD 环境变量,缺省 demo1234(仅本地/预览;生产禁跑本种子)。
 * 所有写操作按纪律记 AuditLog(userId=管理层演示账号)。
 */
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
