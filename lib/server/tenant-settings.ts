/**
 * F1:租户配置读取/写入(服务端)。
 * 读:无记录返回默认(产品化默认可用,不要求先配置);
 * 写:整体校验通过才落库,写审计。
 */
import { resolveTenantSettings, TenantSettingsSchema, type TenantSettings } from "@/lib/domain/tenant-settings";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";

export async function getTenantSettings(tenantId: string) {
  const row = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  return resolveTenantSettings(row?.settings ?? null);
}

/** 单个 flag 便捷读取(F6/F7 页面用) */
export async function isFeatureEnabled(
  tenantId: string,
  flag: keyof TenantSettings["featureFlags"],
): Promise<boolean> {
  const { settings } = await getTenantSettings(tenantId);
  return settings.featureFlags[flag];
}

export async function updateTenantSettings(
  tenantId: string,
  userId: string,
  input: unknown,
): Promise<{ ok: true; settings: TenantSettings } | { ok: false; message: string }> {
  const parsed = TenantSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: `配置不合法:${parsed.error.issues.map((i) => `${i.path.join(".")}(${i.message})`).join("、")}`,
    };
  }
  const before = await getTenantSettings(tenantId);
  await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: { settings: parsed.data, updatedById: userId },
    create: { tenantId, settings: parsed.data, updatedById: userId },
  });
  await writeAudit(prisma, {
    tenantId,
    userId,
    action: "TENANT_SETTINGS_UPDATE",
    entityType: "TenantSettings",
    entityId: tenantId,
    before: before.settings as unknown as Record<string, unknown>,
    after: parsed.data as unknown as Record<string, unknown>,
  });
  return { ok: true, settings: parsed.data };
}
