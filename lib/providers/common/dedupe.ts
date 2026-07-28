/**
 * 报价去重(SPEC §8:相同 MPN 去重)。
 *
 * 去重粒度 = 「同一条可下单的采购选项」:
 *   provider + manufacturer + 标准化 MPN + 供应商料号 + 包装形态。
 * ⚠ 不能只按 MPN 合并:同一 MPN 的不同包装(Cut Tape / Tape & Reel)
 *   MOQ、SPQ 与阶梯价都不同,是两个真实可选项,合并会丢失更优采购方案。
 * 完全重复(三方接口重复返回同一条)时,保留阶梯更全、库存更多者;
 * 完全等价时保留先出现者,保证输出稳定。
 */
import { normalizeManufacturer, normalizeMpn } from "./mpn";
import type { NormalizedOffer } from "./normalized-offer";

function betterOf(a: NormalizedOffer, b: NormalizedOffer): NormalizedOffer {
  if (a.priceBreaks.length !== b.priceBreaks.length) {
    return a.priceBreaks.length > b.priceBreaks.length ? a : b;
  }
  const as = a.stock ?? -1;
  const bs = b.stock ?? -1;
  if (as !== bs) return as > bs ? a : b;
  return a;
}

export function offerDedupeKey(o: NormalizedOffer): string {
  return [
    o.provider,
    normalizeManufacturer(o.manufacturer),
    normalizeMpn(o.mpn),
    (o.providerPartNumber ?? "").toUpperCase(),
    (o.packaging ?? "").toUpperCase(),
  ].join("|");
}

export function dedupeOffers(offers: readonly NormalizedOffer[]): NormalizedOffer[] {
  const byKey = new Map<string, NormalizedOffer>();
  const order: string[] = [];
  for (const o of offers) {
    const key = offerDedupeKey(o);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, o);
      order.push(key);
    } else {
      byKey.set(key, betterOf(existing, o));
    }
  }
  return order.map((k) => byKey.get(k)!);
}
