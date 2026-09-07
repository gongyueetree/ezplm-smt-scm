import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PORTAL_COOKIE, verifyPortalSession, type PortalSessionPayload } from "@/lib/auth/portal-session";
import { portalEnabledForTenant, portalGloballyEnabled } from "@/lib/server/portal";

/** 门户页守卫:未启用 404;未登录跳登录 */
export async function requirePortalPage(): Promise<PortalSessionPayload> {
  if (!portalGloballyEnabled()) notFound();
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const session = token ? await verifyPortalSession(token) : null;
  if (!session) redirect("/portal/login");
  if (!(await portalEnabledForTenant(session.tenantId))) notFound();
  return session;
}
