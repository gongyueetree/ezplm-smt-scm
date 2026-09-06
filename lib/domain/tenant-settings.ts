/**
 * F1:租户配置与 feature flag 的**纯数据层**(schema + 合并规则)。
 *
 * 产品化基座:客户特有规则一律进这里,不写死在代码里。
 * 三条合并纪律:
 * 1. **读取时合并默认值** —— 库里没有的键用默认,不因为少配一项就崩;
 * 2. **未知键忽略、坏值回落默认并记录** —— 一条脏配置不能搞垮整租户,
 *    但回落必须体现在结果里(`invalidKeys`),不许静默吞;
 * 3. **默认值保守**:所有 feature flag 默认关;主数据源默认 EZPLM
 *    (CLAUDE.md 融合钉子:ezPLM 是现租户的唯一真源)。
 */
import { z } from "zod";

/** feature flag 清单 —— F2/F6/F7 的开关都在这里注册,新增开关不需要 migration */
export const FeatureFlagsSchema = z.object({
  /** F7:BOM 版本演进图谱 */
  "bom.versionGraph": z.boolean().default(false),
  /** F7:制造工程信息四卡 */
  "bom.manufacturingInfo": z.boolean().default(false),
  /** F2:ECN 影响分析面板 */
  "ecn.impactAnalysis": z.boolean().default(false),
  /** F2:ECN 客户告知轻量版 */
  "ecn.customerNotice": z.boolean().default(false),
  /** F6:客户门户 */
  "customerPortal": z.boolean().default(false),
});
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const TenantSettingsSchema = z.object({
  featureFlags: FeatureFlagsSchema.default(() => FeatureFlagsSchema.parse({})),
  /**
   * 主数据真源(KICKOFF 修订 1):按租户配置,业务代码经 MasterDataProvider
   * 消费,不感知差异。KINGDEE 在 F4 落地,当前取值只影响显示与校验。
   */
  masterDataSource: z.enum(["EZPLM", "KINGDEE", "NONE"]).default("EZPLM"),
  /** ERP 流程回写目标(F4):NONE = 只有 Excel 兜底链 */
  erpProvider: z.enum(["KINGDEE", "ERP_LAB", "NONE"]).default("NONE"),
  /** F7:匹配置信度阈值(「一键确认高置信」的线),租户可调不硬编码 */
  matchConfidenceThreshold: z.number().min(0.5).max(1).default(0.9),
});
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

export const DEFAULT_TENANT_SETTINGS: TenantSettings = TenantSettingsSchema.parse({});

export interface ResolvedTenantSettings {
  settings: TenantSettings;
  /** 因坏值回落默认的键 —— 界面要显示出来,不静默 */
  invalidKeys: string[];
}

/** 合并存储值与默认值;逐键校验,坏键回落并记录 */
export function resolveTenantSettings(raw: unknown): ResolvedTenantSettings {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { settings: DEFAULT_TENANT_SETTINGS, invalidKeys: [] };
  }
  const parsed = TenantSettingsSchema.safeParse(raw);
  if (parsed.success) return { settings: parsed.data, invalidKeys: [] };

  // 整体不过时逐键抢救:合法的键保留,坏键回落默认并登记
  const invalidKeys = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
  const clean: Record<string, unknown> = {};
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(TenantSettingsSchema.shape)) {
    if (!(key in obj)) continue;
    if (invalidKeys.some((k) => k === key || k.startsWith(`${key}.`))) {
      // featureFlags 内部坏键:抢救其余 flag
      if (key === "featureFlags" && typeof obj[key] === "object" && obj[key] !== null) {
        const flags: Record<string, unknown> = {};
        for (const [fk, fv] of Object.entries(obj[key] as Record<string, unknown>)) {
          if (typeof fv === "boolean" && fk in FeatureFlagsSchema.shape) flags[fk] = fv;
        }
        clean[key] = flags;
      }
      continue;
    }
    clean[key] = obj[key];
  }
  return { settings: TenantSettingsSchema.parse(clean), invalidKeys };
}
