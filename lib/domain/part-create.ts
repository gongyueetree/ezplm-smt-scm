/**
 * 手工建料的领域规则(纯函数,可完全单测)。
 *
 * 覆盖三件事:
 * ① 内部料号自动编码与校验;
 * ② 疑似重复判定 —— **不允许静默创建**,必须让人选处置;
 * ③ 正式创建前的完整性校验(草稿可以缺,正式不行)。
 *
 * 纪律:
 * - 唯一性一律 **tenantId + internalPn**,不存在全局唯一;
 * - 疑似重复只**给候选与理由**,判不判重由人定 —— 系统不替人合并物料;
 * - AI 提取的值**不得直接覆盖人工已填字段**(见 mergeExtracted)。
 */

export type PartCreateOrigin = "MANUAL" | "EZPLM_REFERENCE" | "IMPORT" | "ERP_SYNC";

export interface PartDraftInput {
  internalPn?: string | null;
  mpn?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  categoryL1?: string | null;
  categoryL2?: string | null;
}

export interface FieldIssue {
  field: string;
  message: string;
}

/** 正式创建的必填项(截图「标 * 为必填项」的五项) */
export const REQUIRED_FOR_ACTIVE = [
  "internalPn",
  "mpn",
  "categoryL1",
  "manufacturer",
  "description",
] as const;

const FIELD_LABELS: Record<string, string> = {
  internalPn: "内部料号",
  mpn: "制造商料号 (MPN)",
  categoryL1: "物料分类",
  manufacturer: "制造商",
  description: "中文描述",
};

/**
 * 草稿校验:只要有**任意一个**可识别信息即可存,便于"填一半先存着"。
 * 完全空白的草稿没有意义,拒绝。
 */
export function validateDraft(input: PartDraftInput): FieldIssue[] {
  const any =
    input.internalPn?.trim() ||
    input.mpn?.trim() ||
    input.description?.trim() ||
    input.manufacturer?.trim();
  return any ? [] : [{ field: "_", message: "草稿至少要填一项:内部料号 / MPN / 制造商 / 描述" }];
}

/** 正式创建校验:必填项一个都不能少 */
export function validateForActivation(input: PartDraftInput): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const f of REQUIRED_FOR_ACTIVE) {
    const v = (input as Record<string, unknown>)[f];
    if (typeof v !== "string" || !v.trim()) {
      issues.push({ field: f, message: `${FIELD_LABELS[f]} 为必填项` });
    }
  }
  return issues;
}

/**
 * 内部料号编码规则(截图提示:`EE-[类别]-[型号]`)。
 *
 * 规则是**按租户可配的模板串**,不是写死的:
 *   `{prefix}-{cat}-{key}`,占位符 {prefix} {cat} {key} {seq}
 * 生成失败(缺少必要输入)时返回 null —— 由人工填,不硬凑一个。
 */
export interface CodeRuleContext {
  prefix?: string;
  categoryCode?: string | null;
  /** 型号关键段,通常取 MPN 去掉后缀 */
  key?: string | null;
  /** 流水号(调用方从库里取下一个) */
  seq?: number | null;
}

export function buildInternalPn(template: string, ctx: CodeRuleContext): string | null {
  const prefix = (ctx.prefix ?? "EE").trim();
  const cat = (ctx.categoryCode ?? "").trim();
  const key = (ctx.key ?? "").trim();

  if (template.includes("{cat}") && !cat) return null;
  if (template.includes("{key}") && !key) return null;
  if (template.includes("{seq}") && (ctx.seq === null || ctx.seq === undefined)) return null;

  const out = template
    .replace(/\{prefix\}/g, prefix)
    .replace(/\{cat\}/g, cat)
    .replace(/\{key\}/g, key)
    .replace(/\{seq\}/g, ctx.seq === null || ctx.seq === undefined ? "" : String(ctx.seq).padStart(4, "0"));

  const normalized = normalizeInternalPn(out);
  return normalized || null;
}

/** 归一:去空白、转大写、压缩重复分隔符 */
export function normalizeInternalPn(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** 从 MPN 取型号关键段:去掉常见封装/包装后缀 */
export function mpnKeySegment(mpn: string): string {
  const base = mpn.normalize("NFKC").toUpperCase().trim();
  // 去掉尾部的包装/卷带后缀(-TR / -T&R / TR / -ND 等),这些不影响"是哪颗料"
  return base.replace(/[-_]?(TR|T&R|REEL|ND|CT|DKR)$/i, "");
}

export type DuplicateKind = "SAME_INTERNAL_PN" | "SAME_MPN" | "SIMILAR_MPN" | "CUSTOMER_PN_ALIAS";

export interface DuplicateCandidate {
  kind: DuplicateKind;
  partId: string | null;
  internalPn: string | null;
  mpn: string | null;
  manufacturer: string | null;
  /** 来源:LOCAL(本地库) / EZPLM(外部真源) */
  from: "LOCAL" | "EZPLM";
  reason: string;
  /** 是否阻断创建(内部料号重复必阻断;MPN 相同只是"疑似") */
  blocking: boolean;
}

export interface DuplicateCheckInput {
  internalPn: string;
  mpn: string | null;
  localByInternalPn?: { id: string; internalPn: string; mpn: string | null; manufacturer: string | null } | null;
  localByMpn?: { id: string; internalPn: string; mpn: string | null; manufacturer: string | null }[];
  ezplmByMpn?: { id: string; internalPn: string | null; mpn: string | null; manufacturer: string | null }[];
  /** 客户料号映射命中(说明这可能是同一颗料的别名) */
  customerPnAlias?: { id: string; internalPn: string; mpn: string | null; manufacturer: string | null }[];
}

/**
 * 疑似重复判定。
 *
 * - **内部料号在同租户重复 → 阻断**(唯一约束就是这么定的);
 * - MPN 相同 / 去后缀后相同 / 命中客户料号别名 → **疑似**,不阻断,但必须让人处置;
 * - ezPLM 里已有同 MPN → 提示"可以直接引用,不必自建"。
 */
export function checkDuplicates(input: DuplicateCheckInput): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const key = input.mpn ? mpnKeySegment(input.mpn) : null;

  if (input.localByInternalPn) {
    out.push({
      kind: "SAME_INTERNAL_PN",
      partId: input.localByInternalPn.id,
      internalPn: input.localByInternalPn.internalPn,
      mpn: input.localByInternalPn.mpn,
      manufacturer: input.localByInternalPn.manufacturer,
      from: "LOCAL",
      reason: `内部料号「${input.internalPn}」在本租户已存在 —— 内部料号必须唯一`,
      blocking: true,
    });
  }

  for (const p of input.localByMpn ?? []) {
    const exact = p.mpn && input.mpn && p.mpn.toUpperCase() === input.mpn.toUpperCase();
    out.push({
      kind: exact ? "SAME_MPN" : "SIMILAR_MPN",
      partId: p.id,
      internalPn: p.internalPn,
      mpn: p.mpn,
      manufacturer: p.manufacturer,
      from: "LOCAL",
      reason: exact
        ? `本地库已有相同 MPN「${p.mpn}」(内部料号 ${p.internalPn})`
        : `本地库有型号高度相似的料「${p.mpn}」—— 去掉包装后缀后与「${key}」一致`,
      blocking: false,
    });
  }

  for (const p of input.ezplmByMpn ?? []) {
    out.push({
      kind: "SAME_MPN",
      partId: null,
      internalPn: p.internalPn,
      mpn: p.mpn,
      manufacturer: p.manufacturer,
      from: "EZPLM",
      reason: `ezPLM 中已有该 MPN —— 可直接引用其数据,不必手工自建`,
      blocking: false,
    });
  }

  for (const p of input.customerPnAlias ?? []) {
    out.push({
      kind: "CUSTOMER_PN_ALIAS",
      partId: p.id,
      internalPn: p.internalPn,
      mpn: p.mpn,
      manufacturer: p.manufacturer,
      from: "LOCAL",
      reason: `命中客户料号映射,可能是同一颗料的别名(现有内部料号 ${p.internalPn})`,
      blocking: false,
    });
  }

  return out;
}

export function hasBlockingDuplicate(candidates: readonly DuplicateCandidate[]): boolean {
  return candidates.some((c) => c.blocking);
}

export interface ExtractedField {
  value: string;
  confidence: number;
  sourceFile?: string | null;
}

export interface MergeResult<T> {
  merged: T;
  /** 被保留的人工值(AI 想改但没让它改) */
  keptManual: string[];
  /** 实际由 AI 填入的字段(原本为空) */
  filledByAi: string[];
}

/**
 * 把 AI/OCR 提取的字段并入表单值。
 *
 * **铁律:只填空,绝不覆盖人工已填的值。**
 * 人填了 LQFP-48,模型从规格书读出 LQFP48,不能自作主张改掉 ——
 * 用户会以为自己填的还在,实际已被悄悄替换。
 */
export function mergeExtracted<T extends Record<string, string | null | undefined>>(
  manual: T,
  extracted: Record<string, ExtractedField>,
): MergeResult<T> {
  const merged = { ...manual };
  const keptManual: string[] = [];
  const filledByAi: string[] = [];

  for (const [field, ex] of Object.entries(extracted)) {
    const cur = manual[field];
    if (typeof cur === "string" && cur.trim() !== "") {
      keptManual.push(field);
      continue;
    }
    (merged as Record<string, string>)[field] = ex.value;
    filledByAi.push(field);
  }
  return { merged, keptManual, filledByAi };
}
