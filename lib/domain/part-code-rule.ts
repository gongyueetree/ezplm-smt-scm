/**
 * 内部料号编码规则(纯函数)。
 *
 * 原实现把规则写死在输入框的提示文案里(`EE-[类别]-[型号]`),
 * 换个租户就不适用,也无法预览"下一个号是什么"。
 *
 * 纪律:
 * - **发号与校验用同一套规则**,否则自动生成的号可能过不了自己的校验;
 * - 流水号**不足位补零**,保证字典序与数字序一致(排序、导出、对账都依赖这点);
 * - 关闭"允许人工指定"后,**人工填的号必须被拒**,而不是悄悄替换成自动号 ——
 *   悄悄替换会让人以为自己填的生效了。
 */

export interface PartCodeRuleSpec {
  prefix: string;
  includeCategory: boolean;
  separator: string;
  sequenceWidth: number;
  currentSequence: number;
  allowManual: boolean;
  categoryL1?: string | null;
}

/** 一级分类 → 编码用的短码。映射不到时用 `GEN`(通用),**不猜** */
const CATEGORY_CODE: Record<string, string> = {
  IC: "IC",
  分立器件: "DS",
  阻容感: "RC",
  连接器: "CN",
  机电: "EM",
  模块: "MD",
  结构件: "MC",
  其它: "GEN",
};

export function categoryCode(categoryL1: string | null | undefined): string {
  if (!categoryL1) return "GEN";
  return CATEGORY_CODE[categoryL1] ?? "GEN";
}

export interface GeneratedCode {
  code: string;
  /** 组成部分,便于 UI 解释"这个号是怎么来的" */
  parts: { prefix: string; category: string | null; sequence: string };
  nextSequence: number;
}

/**
 * 生成下一个料号。**纯函数** —— 不读库、不自增,
 * 水位由调用方在事务里推进,避免并发发出重号。
 */
export function generateCode(
  rule: PartCodeRuleSpec,
  categoryL1: string | null | undefined,
  sequence?: number,
): GeneratedCode {
  const seq = sequence ?? rule.currentSequence + 1;
  const width = Math.max(1, Math.min(12, rule.sequenceWidth));
  const seqStr = String(Math.max(0, seq)).padStart(width, "0");
  const cat = rule.includeCategory ? categoryCode(categoryL1) : null;

  const segments = [rule.prefix, ...(cat ? [cat] : []), seqStr].filter((x) => x !== "");
  return {
    code: segments.join(rule.separator),
    parts: { prefix: rule.prefix, category: cat, sequence: seqStr },
    nextSequence: seq,
  };
}

export type CodeCheck =
  | { ok: true; code: string; source: "MANUAL" | "GENERATED" }
  | { ok: false; reason: string };

/**
 * 决定最终采用哪个料号。
 *
 * - 人工填了且规则允许 → 用人工的;
 * - 人工填了但规则**不允许** → **拒绝**,不静默替换;
 * - 没填 → 自动生成。
 */
export function resolveCode(
  rule: PartCodeRuleSpec,
  input: { manualCode?: string | null; categoryL1?: string | null; sequence?: number },
): CodeCheck {
  const manual = input.manualCode?.trim();
  if (manual) {
    if (!rule.allowManual) {
      return {
        ok: false,
        reason:
          "当前编码规则**不允许人工指定料号**。请清空料号由系统自动生成,或先在编码规则中打开「允许人工指定」",
      };
    }
    if (!/^[A-Za-z0-9._-]{2,50}$/.test(manual)) {
      return {
        ok: false,
        reason: `料号「${manual}」含不允许的字符 —— 只接受字母、数字与 . _ -,长度 2–50`,
      };
    }
    return { ok: true, code: manual, source: "MANUAL" };
  }
  return { ok: true, code: generateCode(rule, input.categoryL1, input.sequence).code, source: "GENERATED" };
}

/** 预览接下来的若干个号 —— UI 用它让人看清规则效果 */
export function previewCodes(
  rule: PartCodeRuleSpec,
  categoryL1: string | null | undefined,
  count = 3,
): string[] {
  return Array.from({ length: Math.max(1, Math.min(20, count)) }, (_, i) =>
    generateCode(rule, categoryL1, rule.currentSequence + 1 + i).code,
  );
}
