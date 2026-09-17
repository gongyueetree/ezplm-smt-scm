/**
 * R0-4:报价行的**字段级 patch**(纯函数)。
 *
 * 与「整行 upsert」是两种语义,不能混用:
 * - upsert:调用方给出整行的完整状态,未给的字段**就是要清空**(编辑器保存即此语义);
 * - patch :调用方只想改其中几个字段,**没提到的字段必须原样不动**。
 *
 * 缺陷现场:Agent 审批走的是 upsert,只传了 4 个字段,
 * 于是批准一条 AI 分类建议会把该行 qty / purchaseCost / customerPrice /
 * quotedMfg / quotedMpn / altMfg / altMpn / note 全部置 null ——
 * 连 markup 要乘的 purchaseCost 一起抹掉。
 *
 * 判定规则只有一条:**`undefined` = 未提供(省略);`null` = 人要清空(保留)**。
 */

/** 可被 patch 的报价行字段(与 Prisma QuoteLine 的可写列一致) */
export const PATCHABLE_QUOTE_LINE_FIELDS = [
  "category",
  "qty",
  "purchaseCost",
  "markupPct",
  "customerPrice",
  "quotedMfg",
  "quotedMpn",
  "materialCategory",
  "altMfg",
  "altMpn",
  "note",
] as const;

export type PatchableQuoteLineField = (typeof PATCHABLE_QUOTE_LINE_FIELDS)[number];

export type QuoteLinePatchInput = Partial<Record<PatchableQuoteLineField, string | null | undefined>>;

/**
 * 把「调用方显式提到的字段」挑出来;`undefined` 一律省略。
 * 返回空对象是合法结果 —— 调用方据此**跳过写库**,而不是写一行空值。
 */
export function buildQuoteLinePatch(
  input: QuoteLinePatchInput,
): Partial<Record<PatchableQuoteLineField, string | null>> {
  const patch: Partial<Record<PatchableQuoteLineField, string | null>> = {};
  for (const key of PATCHABLE_QUOTE_LINE_FIELDS) {
    const v = input[key];
    if (v !== undefined) patch[key] = v;
  }
  return patch;
}
