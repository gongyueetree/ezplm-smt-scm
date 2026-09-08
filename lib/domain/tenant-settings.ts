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
  /**
   * closed-loop P0-6:ERP_LAB 为**测试专用**主数据源(UI 必须标「ERP 仿真主数据」,
   * 严禁显示为金蝶/正式已连接)。
   */
  masterDataSource: z.enum(["EZPLM", "KINGDEE", "ERP_LAB", "NONE"]).default("EZPLM"),
  /** ERP 流程回写目标(F4):NONE = 只有 Excel 兜底链 */
  erpProvider: z.enum(["KINGDEE", "ERP_LAB", "NONE"]).default("NONE"),
  /**
   * closed-loop P0-2:本租户对应的 Lab 数据集租户(如 primatronics-uat)。
   * **不填时不回落共享数据集**?—— 回落 ezplm-demo 仅用于演示;
   * 多个 ezPLM 租户各自配置,严禁共用同一客户数据集(部署文档已注明)。
   */
  erpLabTenantId: z.string().trim().min(2).max(64).nullable().default(null),
  /** F7:匹配置信度阈值(「一键确认高置信」的线),租户可调不硬编码 */
  /**
   * F2:ECN 评审阶段启停(租户级)。MANAGEMENT 批准阶段**不可关**,
   * 不进配置;角色只取五值枚举 —— 无品质/总经理(PAGE_SPEC_ECN §0)。
   */
  ecnReviewStages: z
    .object({
      engineering: z.boolean().default(true),
      procurement: z.boolean().default(true),
    })
    .default(() => ({ engineering: true, procurement: true })),
  /**
   * R3-5:ECN 审批链升级为**有序阶段列表**(为将来 QUALITY 等新阶段留配置位,
   * 角色枚举不动)。null = 未显式配置,回落上面的布尔启停(向后兼容)。
   * 校验兜底:非空、去重、MANAGEMENT 必须收尾 —— 不合法整键回落默认并进 invalidKeys。
   */
  ecnApprovalStages: z
    .array(z.enum(["ENGINEERING", "PROCUREMENT", "MANAGEMENT"]))
    .min(1)
    .max(6)
    .refine((v) => v[v.length - 1] === "MANAGEMENT", "MANAGEMENT 批准阶段必须收尾且不可关闭")
    .refine((v) => new Set(v).size === v.length, "阶段不可重复")
    .nullable()
    .default(null),
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
