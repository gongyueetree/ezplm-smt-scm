import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { portalGloballyEnabled } from "@/lib/server/portal";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { PortalAccountManager } from "./manager";

export const dynamic = "force-dynamic";

/**
 * R3-3:门户账号管理(仅 MANAGEMENT,页面级角色由 lib/routes.ts 声明)。
 * 邀请制:不再代设初始密码 —— 生成一次性激活链接,客户自设密码。
 */
export default async function PortalAccountsPage() {
  const session = (await getSession())!;
  const [accounts, customers, settings] = await Promise.all([
    prisma.portalAccount.findMany({
      where: tenantWhere(session.tenantId),
      select: {
        id: true,
        email: true,
        customerId: true,
        status: true,
        passwordChangedAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    getTenantSettings(session.tenantId),
  ]);

  const envOn = portalGloballyEnabled();
  const flagOn = settings.settings.featureFlags.customerPortal === true;
  const customerById = new Map(customers.map((c) => [c.id, `${c.name}(${c.code})`]));

  return (
    <div>
      <PageHeader path="/settings/portal-accounts" />
      {!envOn || !flagOn ? (
        <Banner tone="warn">
          客户门户当前未完全启用(env {envOn ? "开" : "关"} / 租户 flag {flagOn ? "开" : "关"},
          双开关任一关闭时门户与激活链接一律 404)。可先建号,启用后链接方可使用。
        </Banner>
      ) : null}
      <Card
        title="门户账号"
        sub="邀请制:激活链接单次使用、7 天有效;密码由客户自设,系统与管理员均不知道。SMTP 未配置时请复制链接手工发送 —— 本页永不显示「邮件已发送」。"
      >
        <PortalAccountManager
          accounts={accounts.map((a) => ({
            id: a.id,
            email: a.email,
            customer: customerById.get(a.customerId) ?? a.customerId,
            status: a.status,
            passwordChangedAt: a.passwordChangedAt?.toISOString() ?? null,
            lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
          }))}
          customers={customers}
        />
      </Card>
    </div>
  );
}
