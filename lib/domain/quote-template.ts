/**
 * 报价模板选取(客户 xlsx:「A/B/C 类客户差异化报价规则配置,多套报价模板预设」)。
 *
 * 纪律:
 * - **不写死任何百分比**。模板里的默认 Markup 由人维护;代码只负责"选哪一套",
 *   不负责"该收多少"——未经甲方确认的数字一旦写进代码就会被当成系统标准;
 * - 客户**未评级 ≠ C 级**:未评级就是未评级,只能落到通用模板,不猜等级;
 * - 选中的模板只提供**默认值**,报价行仍可人工覆盖;
 * - 口径未确认的模板照样能用,但必须把"待确认"这件事一路带到 UI。
 */

export type CustomerTierValue = "A" | "B" | "C";

export interface QuoteTemplateRef {
  id: string;
  name: string;
  /** null = 通用模板 */
  tier: CustomerTierValue | null;
  /** 十进制字符串,如 "0.15";null = 未维护 */
  defaultMarkupPct: string | null;
  laborTemplateId: string | null;
  confirmedByBusiness: boolean;
}

export type TemplatePickReason =
  | "tier_match"
  | "generic_fallback"
  | "no_template"
  | "customer_unrated";

export interface TemplatePick {
  template: QuoteTemplateRef | null;
  reason: TemplatePickReason;
  /** 给 UI 直接用的说明,已包含口径是否确认 */
  detail: string;
  /** 是否需要在 UI 上标注"口径待确认" */
  needsConfirmationNotice: boolean;
}

/**
 * 按客户等级挑模板。
 *
 * 顺序:等级完全匹配 → 通用模板(tier=null)→ 没有可用模板。
 * 同一档有多套时取**名称升序第一套**,保证结果稳定可复现(不靠隐式的插入顺序)。
 */
export function pickQuoteTemplate(
  templates: readonly QuoteTemplateRef[],
  tier: CustomerTierValue | null,
): TemplatePick {
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const notice = (t: QuoteTemplateRef) =>
    t.confirmedByBusiness
      ? ""
      : "(该模板口径**未经业务确认**,属演示配置,不构成正式定价规则)";

  if (tier) {
    const hit = sorted.find((t) => t.tier === tier);
    if (hit) {
      return {
        template: hit,
        reason: "tier_match",
        detail:
          `客户等级 ${tier} → 套用模板「${hit.name}」` +
          (hit.defaultMarkupPct === null
            ? ";该模板尚未维护默认 Markup,报价行需人工填写"
            : `,默认 Markup ${(Number(hit.defaultMarkupPct) * 100).toFixed(2)}%`) +
          notice(hit),
        needsConfirmationNotice: !hit.confirmedByBusiness,
      };
    }
  }

  const generic = sorted.find((t) => t.tier === null);
  if (generic) {
    return {
      template: generic,
      reason: tier ? "generic_fallback" : "customer_unrated",
      detail:
        (tier
          ? `没有为等级 ${tier} 配置模板,回落通用模板「${generic.name}」`
          : `该客户**尚未评级**(未评级不等于 C 级),回落通用模板「${generic.name}」`) +
        (generic.defaultMarkupPct === null
          ? ";该模板尚未维护默认 Markup,报价行需人工填写"
          : `,默认 Markup ${(Number(generic.defaultMarkupPct) * 100).toFixed(2)}%`) +
        notice(generic),
      needsConfirmationNotice: !generic.confirmedByBusiness,
    };
  }

  return {
    template: null,
    reason: "no_template",
    detail: tier
      ? `没有为等级 ${tier} 配置模板,也没有通用模板 —— 报价参数需全部人工填写`
      : "该客户尚未评级,且没有通用模板 —— 报价参数需全部人工填写",
    needsConfirmationNotice: false,
  };
}
