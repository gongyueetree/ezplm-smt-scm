/**
 * REF-0.8:重构期 feature flag(纯函数)。
 *
 * 这些 flag 是**迁移期脚手架**,不是业务功能开关:
 * - 不进 `TenantSettings` —— 那是业务配置面,会出现在设置 UI 上,
 *   而"要不要用新版归一实现"不是客户该看到、更不是客户该决定的事;
 * - 走**部署期环境变量**,与 `PROVIDERS_FORCE_MOCK` 同一层级;
 * - 迁移完成即连同旧实现一起删除(见 MIGRATION_PLAN §2)。
 *
 * 纪律:
 * 1. **默认全关**。未设置、空串、无法识别的值一律视为关 ——
 *    "看不懂就当开着"是最危险的默认;
 * 2. 只认明确的真值(`1` / `true` / `on` / `yes`,大小写不敏感);
 * 3. 取值来源可解释(`refactorFlagStatus`),便于回答
 *    "为什么这台机器跑的是新实现" —— 与权限体系的 explain 同一思路。
 */

/** 迁移期 flag 全集;每个都对应 MIGRATION_PLAN §1 的一个 REF-x */
export const REFACTOR_FLAGS = [
  /** REF-1:Canonical Part Identity + Manufacturer Registry */
  "PART_IDENTITY_V2",
  /** REF-2:BOM Normalization V2 */
  "BOM_NORMALIZER_V2",
  /** REF-3:Supplier Mapping V2 + NormalizedOffer 收敛 */
  "SUPPLIER_MAPPING_V2",
  /** REF-4:Alternate Engine V2 */
  "ALTERNATE_ENGINE_V2",
] as const;

export type RefactorFlag = (typeof REFACTOR_FLAGS)[number];

export function isRefactorFlag(v: string): v is RefactorFlag {
  return (REFACTOR_FLAGS as readonly string[]).includes(v);
}

/** 环境变量名:统一加 REFACTOR_ 前缀,免得与业务配置混在一起 */
export function refactorFlagEnvName(flag: RefactorFlag): string {
  return `REFACTOR_${flag}`;
}

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["", "0", "false", "off", "no"]);

export type FlagSource =
  /** 环境变量明确打开 */
  | "ENV_ON"
  /** 环境变量明确关闭 */
  | "ENV_OFF"
  /** 未设置 → 默认关 */
  | "DEFAULT_OFF"
  /** 设了但认不出 → 当作关,并且要能被看见(不静默) */
  | "UNRECOGNIZED_OFF";

export interface FlagState {
  flag: RefactorFlag;
  on: boolean;
  source: FlagSource;
  /** 认不出的原始值(已截断;便于运维排查拼写错误) */
  rawValue: string | null;
}

export function refactorFlagState(
  flag: RefactorFlag,
  env: Record<string, string | undefined> = process.env,
): FlagState {
  const raw = env[refactorFlagEnvName(flag)];
  if (raw === undefined) return { flag, on: false, source: "DEFAULT_OFF", rawValue: null };

  const v = raw.trim().toLowerCase();
  if (TRUTHY.has(v)) return { flag, on: true, source: "ENV_ON", rawValue: raw };
  if (FALSY.has(v)) return { flag, on: false, source: "ENV_OFF", rawValue: raw };
  // 认不出一律当关,但把原值留下来 —— 拼错的开关不该表现得和"没设"一模一样
  return { flag, on: false, source: "UNRECOGNIZED_OFF", rawValue: raw.slice(0, 40) };
}

export function isRefactorFlagOn(
  flag: RefactorFlag,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return refactorFlagState(flag, env).on;
}

/** 全量状态(给集成状态页/诊断用;不含任何密钥) */
export function refactorFlagStatus(
  env: Record<string, string | undefined> = process.env,
): FlagState[] {
  return REFACTOR_FLAGS.map((f) => refactorFlagState(f, env));
}
