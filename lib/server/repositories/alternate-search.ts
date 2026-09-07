/**
 * 替代料检索与评分(服务端编排层)。
 *
 * 流程:取被替代件规格 → 汇集候选(本地库 / ezPLM / DigiKey)→
 * 逐项参数比对 → 四维评分 → 按模式排序 → Top N。
 *
 * 纪律:
 * - 每个参数值都记录**取数来源**,AI/检索来的与本地库的不能同权;
 * - Pin-to-Pin 未经人工核对引脚,永不判"可直接替换"(见 alternate-score.ts);
 * - 只返回候选与依据,**不写任何替代关系**。
 */
import {
  MODE_LABELS,
  rankScored,
  scoreAlternate,
  type CandidateSpec,
  type ParamConstraint,
  type ScoredAlternate,
  type SubstitutionMode,
} from "@/lib/domain/alternate-score";
import { summarizeMarket, type MarketSummary } from "@/lib/domain/market-summary";
import { matchParamName } from "@/lib/domain/param-compare";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";
import { normalizeMpn } from "@/lib/providers/common/mpn";
import { rankBySimilarity } from "@/lib/domain/similarity";
import { getDigiKeyProvider } from "@/lib/providers/digikey";
import { getMouserProvider } from "@/lib/providers/mouser";
import { getMasterDataProvider, masterDataMode } from "@/lib/providers/master-data";
import { prisma } from "@/lib/server/db";
import { getPartDetail } from "@/lib/server/repositories/part-detail";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface AlternateSearchInput {
  tenantId: string;
  mpn: string;
  mode: SubstitutionMode;
  /** 参数约束,顺序即优先级;为空时由被替代件的参数自动生成 */
  constraints?: ParamConstraint[];
  preferredManufacturers?: string[];
  limit?: number;
  /**
   * 是否为**最终入选的** Top N 查询市场行情。
   * 只查入选的几条 —— 给每个候选都打一次分销商接口会瞬间烧完日配额。
   */
  includeMarket?: boolean;
  /** 询价数量,决定供货档位的判断基准(库存 5000 对样品充足,对量产紧张) */
  demandQty?: number;
}

export interface AlternateSearchResult {
  subject: {
    mpn: string;
    manufacturer: string | null;
    description: string | null;
    category: string | null;
    localHit: boolean;
  };
  constraints: ParamConstraint[];
  mode: SubstitutionMode;
  modeLabel: { title: string; desc: string };
  results: (ScoredAlternate & { market: MarketSummary | null })[];
  candidateCount: number;
  degraded: { provider: string; kind: string; message: string }[];
}

/** 从物料详情的参数表推出默认约束;顺序即默认优先级 */
export function buildConstraintsFromParams(
  params: { name: string; value: string; unit: string | null }[],
  footprint: string | null,
): ParamConstraint[] {
  const HIGHER_IS_BETTER = /(频率|主频|FLASH|SRAM|存储|容量|GPIO|通道|数量|MHZ|KB|MB)/i;
  const out: ParamConstraint[] = [];
  if (footprint) {
    out.push({ key: "package", label: "封装", required: footprint, compareAs: "package" });
  }
  for (const p of params) {
    const key = `p_${out.length}`;
    out.push({
      key,
      label: p.name,
      required: p.unit ? `${p.value} ${p.unit}` : p.value,
      higherIsBetter: HIGHER_IS_BETTER.test(`${p.name}${p.value}${p.unit ?? ""}`),
    });
  }
  return out;
}

export async function searchAlternates(
  input: AlternateSearchInput,
): Promise<AlternateSearchResult> {
  const degraded: AlternateSearchResult["degraded"] = [];
  const detail = await getPartDetail(input.tenantId, input.mpn);
  degraded.push(...detail.degraded);
  const subjectCategory = detail.part?.category ?? null;

  const subjectFootprint = (detail.fields.footprint.value as string | null) ?? null;
  const constraints =
    input.constraints && input.constraints.length > 0
      ? input.constraints
      : buildConstraintsFromParams(detail.parameters, subjectFootprint);

  const localParts = await prisma.part.findMany({
    where: tenantWhere(input.tenantId),
    take: 5000,
  });
  const selfKey = normalizeMpn(input.mpn);
  const localHit = localParts.some((p) => normalizeMpn(p.mpn ?? "") === selfKey);

  const specs: CandidateSpec[] = [];
  const seen = new Set<string>([selfKey]);
  const add = (spec: CandidateSpec) => {
    const key = normalizeMpn(spec.mpn);
    if (!key || seen.has(key)) return;
    seen.add(key);
    specs.push(spec);
  };

  /** 把一颗料的已知信息塞进参数表:只填**确实知道**的,其余留空(评分按"缺失"处理) */
  const valuesFrom = (source: {
    footprint: string | null;
    description: string | null;
  }): Record<string, string | null> => {
    const values: Record<string, string | null> = {};
    for (const c of constraints) {
      if (c.key === "package") values[c.key] = source.footprint;
      else values[c.key] = null;
    }
    void source.description;
    return values;
  };

  // ① 本地物料库:相似型号
  const localRanked = rankBySimilarity(
    { value: input.mpn, footprint: subjectFootprint },
    localParts
      .filter((p) => p.mpn && normalizeMpn(p.mpn) !== selfKey)
      .map((p) => ({
        mpn: p.mpn!,
        manufacturer: p.manufacturer,
        footprint: p.footprint,
        description: p.description,
      })),
    { limit: 8, minScore: 0.4 },
  );
  for (const r of localRanked) {
    add({
      mpn: r.target.mpn,
      manufacturer: r.target.manufacturer ?? null,
      description: r.target.description ?? null,
      defaultSource: "LOCAL",
      values: valuesFrom({
        footprint: r.target.footprint ?? null,
        description: r.target.description ?? null,
      }),
    });
  }

  // ② 主数据源:同系列型号(带真实参数,能逐项比对)。F4:经 MasterDataProvider,真源随租户配置
  if ((await masterDataMode(input.tenantId)).mode === "http") {
    try {
      const provider = await getMasterDataProvider(input.tenantId);
      // 一次调用同时拿回候选与参数(逐个 getParameters 会 N+1 次打接口,烧配额)
      const withParams = await provider.searchPartsWithParameters({
        keyword: input.mpn,
        limit: 20,
      });
      const paramsByMpn = new Map(
        withParams.filter((x) => x.part.mpn).map((x) => [x.part.mpn!, x.parameters]),
      );
      const found = withParams.map((x) => x.part);
      const ranked = rankBySimilarity(
        { value: input.mpn, footprint: subjectFootprint },
        found
          .filter((p): p is typeof p & { mpn: string } =>
            Boolean(p.mpn) && normalizeMpn(p.mpn ?? "") !== selfKey,
          )
          .map((p) => ({
            mpn: p.mpn,
            manufacturer: p.manufacturer,
            footprint: p.footprint,
            description: p.description,
            id: p.id,
          })),
        { limit: 6, minScore: 0.4 },
      );
      for (const r of ranked) {
        const values = valuesFrom({
          footprint: r.target.footprint ?? null,
          description: r.target.description ?? null,
        });
        // ezPLM 的参数已随检索一并返回,按参数名对上约束项
        const params = paramsByMpn.get(r.target.mpn) ?? [];
        for (const c of constraints) {
          if (c.key === "package") continue;
          // ezPLM 同族物料的属性命名并不统一,按"主名"匹配而不是全等
          const hit = params.find((p) => matchParamName(c.label, p.name));
          if (hit) values[c.key] = hit.unit ? `${hit.value} ${hit.unit}` : hit.value;
        }
        add({
          mpn: r.target.mpn,
          manufacturer: r.target.manufacturer ?? null,
          description: r.target.description ?? null,
          defaultSource: "EZPLM",
          values,
        });
      }
    } catch (e) {
      degraded.push({
        provider: "EZPLM",
        kind: "unknown",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ③ DigiKey Substitutions
  try {
    const subs = await getDigiKeyProvider().getSubstitutes(input.mpn);
    for (const s of subs.slice(0, 6)) {
      add({
        mpn: s.mpn,
        manufacturer: s.manufacturer,
        description: s.description,
        defaultSource: "DIGIKEY",
        values: valuesFrom({ footprint: null, description: s.description }),
      });
    }
  } catch (e) {
    degraded.push({
      provider: "DIGIKEY",
      kind: "unknown",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const scored = specs.map((c) =>
    scoreAlternate(c, {
      mode: input.mode,
      constraints,
      preferredManufacturers: input.preferredManufacturers,
    }),
  );
  const ranked = rankScored(scored, specs, { mode: input.mode, limit: input.limit ?? 5 });

  /*
   * 市场行情:**只查最终入选的这几条**。
   * 候选池有十几条,给每条都打一次 DigiKey+Mouser 就是二三十次调用,
   * 几次分析下来配额就没了。走既有的 15 分钟缓存,页面显示数据更新时间。
   */
  const withMarket: (ScoredAlternate & { market: MarketSummary | null })[] = [];
  for (const r of ranked) {
    if (!input.includeMarket) {
      withMarket.push({ ...r, market: null });
      continue;
    }
    const offers: NormalizedOffer[] = [];
    for (const provider of [getDigiKeyProvider(), getMouserProvider()]) {
      try {
        offers.push(...(await provider.getOffersByMpn({ mpn: r.mpn })));
      } catch (e) {
        degraded.push({
          provider: provider.name,
          kind: "unknown",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    withMarket.push({
      ...r,
      market: offers.length > 0 ? summarizeMarket(offers, { demandQty: input.demandQty }) : null,
    });
  }

  return {
    subject: {
      mpn: input.mpn,
      manufacturer: (detail.fields.manufacturer.value as string | null) ?? null,
      description: (detail.fields.description.value as string | null) ?? null,
      category: subjectCategory,
      localHit,
    },
    constraints,
    mode: input.mode,
    modeLabel: MODE_LABELS[input.mode],
    results: withMarket,
    candidateCount: specs.length,
    degraded,
  };
}
