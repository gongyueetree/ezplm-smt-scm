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
