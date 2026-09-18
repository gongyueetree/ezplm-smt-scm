/**
 * REF-1:统一 Manufacturer Registry(纯函数层)。
 *
 * 现状(REF-0 审计 §7 / DUPLICATION_MATRIX §D2):全仓 **5 处**厂商归一,
 * 最刺眼的是 `resolveManufacturer` **在同一个函数体里混用两套键规则**:
 *   B1 `normalizeManufacturer`  —— 保留空格、剥公司后缀
 *   B4 `manufacturerKeyOf`      —— 剥空格、保留公司后缀
 * 于是 `MURATA ELECTRONICS` 在同一次解析里既是 `MURATA ELECTRONICS` 又是
 * `MURATAELECTRONICS`。
 *
 * ⚠️ **本模块目前不接生产调用点**(REF-1a 只建不切)。
 * 特别注意:`manufacturerKey` 是**库内存量**(ManufacturerAlias.normalizedAlias
 * 有唯一约束),改键规则必须配 key 重算迁移,并处理"两个厂商归一后撞键"的情况 ——
 * 差异量见 rule-divergence 报告,切换在 REF-1c。
 *
 * 保留本仓优于参考仓的部分,不得倒退:
 * - 租户别名分域(tenantId="" 为 GLOBAL,租户别名不跨租户泄漏);
 * - 人工批准后才生成永久别名(§20:不静默造别名);
 * - ezPLM Manufacturer Master 为标准真源;
 * - **未收录厂商只清洗不猜**(bom2buy 同款纪律,两边一致)。
 */

/* ------------------------------------------------------------------ *
 * 1. 公司后缀
 * ------------------------------------------------------------------ */

/**
 * 公司性质后缀 —— 归一时剥掉,它们不区分厂商。
 * 比既有 B1 多了 `LIMITED/INCORPORATED/HOLDINGS/PTE/SAS/SPA/BV/NV/AB/OY`
 * 等常见写法(参考 bom2buy 的成熟清单,规则采纳、实现重写)。
 */
const CORP_SUFFIX =
  /\b(CO|LTD|LIMITED|INC|INCORPORATED|CORP|CORPORATION|COMPANY|GMBH|LLC|PLC|PTE|HOLDINGS?|SA|SAS|SPA|AG|KK|BV|NV|AB|OY)\b/g;

/** 多厂商串的分隔符:`Microchip / Microsemi`、`AVX & Kyocera` */
const ALIAS_SEPARATORS = /[/&|+]/;

/* ------------------------------------------------------------------ *
 * 2. 归一
 * ------------------------------------------------------------------ */

/**
 * 展示用归一:大写、剥公司后缀、压缩空白。**保留空格**,人能读。
 * 用于 UI 呈现与模糊比较,**不可作为库内键**。
 */
export function normalizeManufacturerName(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(CORP_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * **唯一的**厂商键:在展示归一基础上再剥掉所有非字母数字(含 CJK 保留)。
 *
 * 与 MPN 键同一套字符规则(`[^\p{L}\p{N}]`),两处保持一致 ——
 * 不同规则正是 R0-1 事故的成因。
 *
 * ⚠️ 与库内存量 `manufacturerKey` 的差别:存量**没有剥公司后缀**。
 * 例:`MURATA CO LTD` 存量键 = `MURATACOLTD`,本规则 = `MURATA`。
 * 采纳本规则须做 key 重算 + 撞键处理(见 rule-divergence)。
 */
export function manufacturerKey(v: string | null | undefined): string {
  return normalizeManufacturerName(v).replace(/[^\p{L}\p{N}]/gu, "");
}

/** 拆出别名列表:`Microchip / Microsemi` → ["MICROCHIP", "MICROSEMI"] */
export function manufacturerAliasList(v: string | null | undefined): string[] {
  const norm = normalizeManufacturerName(v);
  if (!norm) return [];
  return norm
    .split(ALIAS_SEPARATORS)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * 3. 解析
 * ------------------------------------------------------------------ */

/**
 * 解析优先级(§19 六级的纯函数部分;DB 查询由 infrastructure 层注入)。
 * 顺序即可信度,**不得重排**。
 */
export const MANUFACTURER_RESOLUTION_ORDER = [
  /** 租户批准的别名 —— 最高:这是人工确认过的 */
  "TENANT_ALIAS",
  /** 全局内置别名 */
  "GLOBAL_ALIAS",
  /** ezPLM 标准名精确命中 */
  "CANONICAL_EXACT",
  /** 仅清洗,未收录 —— **不猜** */
  "CLEANED_ONLY",
  /** 空 / 占位符 */
  "UNRESOLVED",
] as const;

export type ManufacturerResolutionKind = (typeof MANUFACTURER_RESOLUTION_ORDER)[number];

/** 占位/垃圾值:与 lib/integration/erp 的 JUNK 口径一致 */
const JUNK = /^(#N\/?A?|N\/?A|NA|0|-+|无|\/|—|待定|未知|TBD)$/i;

export interface ManufacturerLookup {
  /** 租户别名:归一键 → 标准厂商 */
  tenantAlias?: ReadonlyMap<string, { id: string; name: string }>;
  /** 全局别名 */
  globalAlias?: ReadonlyMap<string, { id: string; name: string }>;
  /** 标准名精确 */
  canonical?: ReadonlyMap<string, { id: string; name: string }>;
}

export interface ManufacturerResolution {
  kind: ManufacturerResolutionKind;
  canonicalId: string | null;
  canonicalName: string | null;
  /** 归一键(未收录时仍给出,便于登记为待评审) */
  key: string;
  /** 清洗后的可读名;未收录时这就是最终展示值 */
  cleanedName: string;
  /** 是否需要人工裁决 */
  requiresManualDecision: boolean;
}

/**
 * 解析一个原始厂商串。
 *
 * **未收录一律 CLEANED_ONLY,不做模糊猜测** —— 与 bom2buy 同款纪律
 * (它的注释写得很直白:"未收录的厂商不臆造,只做基本清洗")。
 * 模糊候选属 §19 的第 5 级,由 infrastructure 层带证据给出并**逐条人工批准**,
 * 不在本纯函数里悄悄生效。
 */
export function resolveManufacturer(
  raw: string | null | undefined,
  lookup: ManufacturerLookup = {},
): ManufacturerResolution {
  const cleanedName = normalizeManufacturerName(raw);
  const key = manufacturerKey(raw);
  const trimmed = (raw ?? "").trim();

  if (!trimmed || JUNK.test(trimmed) || !key) {
    return {
      kind: "UNRESOLVED",
      canonicalId: null,
      canonicalName: null,
      key: "",
      cleanedName: "",
      requiresManualDecision: false,
    };
  }

  for (const [kind, map] of [
    ["TENANT_ALIAS", lookup.tenantAlias],
    ["GLOBAL_ALIAS", lookup.globalAlias],
    ["CANONICAL_EXACT", lookup.canonical],
  ] as const) {
    const hit = map?.get(key);
    if (hit) {
      return {
        kind,
        canonicalId: hit.id,
        canonicalName: hit.name,
        key,
        cleanedName,
        requiresManualDecision: false,
      };
    }
  }

  return {
    kind: "CLEANED_ONLY",
    canonicalId: null,
    canonicalName: null,
    key,
    cleanedName,
    // 未收录要进评审队列 —— 但**不阻塞**业务流程
    requiresManualDecision: true,
  };
}

/** 两个厂商串是否指向同一家(标准化 + 别名拆分后逐一比对) */
export function sameManufacturer(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const A = manufacturerAliasList(a).map((x) => x.replace(/[^\p{L}\p{N}]/gu, ""));
  const B = manufacturerAliasList(b).map((x) => x.replace(/[^\p{L}\p{N}]/gu, ""));
  if (A.length === 0 || B.length === 0) return false; // 空不当通配
  return A.some((x) => B.includes(x));
}
