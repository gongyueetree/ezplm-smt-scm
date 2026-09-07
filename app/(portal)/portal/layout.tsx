import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { PORTAL_COOKIE, verifyPortalSession } from "@/lib/auth/portal-session";
import { prisma } from "@/lib/server/db";
import { portalEnabledForTenant, portalGloballyEnabled } from "@/lib/server/portal";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { PortalLogout } from "./logout";

/**
 * F6-B:门户布局 —— 独立认证域守卫(设计 §1/§4)。
 * 只认 portal_session;内部会话在这里没有效力。
 * 双开关任一关闭 → 404(功能不存在,不是无权限)。
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  if (!portalGloballyEnabled()) notFound();

  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const session = token ? await verifyPortalSession(token) : null;

  // 登录页自身不需要会话;其它页未登录跳登录。
  // 布局无法感知子路径,登录判定放在子页;这里只做「有会话时」的共通壳。
  if (!session) {
    return <div style={{ fontFamily: "system-ui, sans-serif" }}>{children}</div>;
  }
  if (!(await portalEnabledForTenant(session.tenantId))) notFound();

  const customer = await prisma.customer.findFirst({
    where: tenantWhere(session.tenantId, { id: session.customerId }),
    select: { name: true },
  });
  if (!customer) redirect("/portal/login");

  const nav = [
    ["/portal", "总览"],
    ["/portal/inventory", "我的库存"],
    ["/portal/transactions", "出入流水"],
    ["/portal/lots", "批次"],
    ["/portal/exports", "导出"],
  ] as const;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f5f6f7" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "10px 20px",
          background: "#fff",
          borderBottom: "1px solid #e5e5e5",
        }}
      >
        <b data-testid="portal-customer-name">{customer.name} · 客户门户</b>
        <nav style={{ display: "flex", gap: 12 }}>
          {nav.map(([href, label]) => (
            <Link key={href} href={href} style={{ fontSize: 14 }}>
              {label}
            </Link>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <span className="small" style={{ fontSize: 12, color: "#888" }}>
          {session.email}
        </span>
        <PortalLogout />
      </header>
      <main style={{ maxWidth: 960, margin: "24px auto", padding: "0 16px" }}>{children}</main>
    </div>
  );
}
