import { NextResponse } from "next/server";
import { forbidden, requireSession } from "@/lib/server/api";
import { getTenantSettings, updateTenantSettings } from "@/lib/server/tenant-settings";

export const runtime = "nodejs";

/** F1:租户配置(feature flag / 主数据源 / 阈值)。管理层专属 —— 它改变全租户行为 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.includes("MANAGEMENT")) {
    return forbidden("租户配置属管理层", "tenant_settings_role");
  }
  const { settings, invalidKeys } = await getTenantSettings(auth.session.tenantId);
  return NextResponse.json({
    settings,
    invalidKeys,
    note: invalidKeys.length
      ? `存储中有 ${invalidKeys.length} 个坏键已回落默认:${invalidKeys.join("、")} —— 请重新保存修正`
      : null,
  });
}

export async function PUT(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.includes("MANAGEMENT")) {
    return forbidden("租户配置属管理层", "tenant_settings_role");
  }
  const body = await req.json().catch(() => null);
  const result = await updateTenantSettings(auth.session.tenantId, auth.session.userId, body);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json({ settings: result.settings });
}
