/**
 * 物料详情聚合(客户需求:任意页面点开型号即可查看详情)。
 *
 * 数据来源与主权:
 * - **ezPLM** = 物料主数据 / 规格参数 / 库文件 / 数据手册 的唯一真源(只读);
 * - **本地 Part 表** = 只读缓存,ezPLM 不可用时的降级来源;
 * - **替代料** = ezPLM API **不提供**该能力(见手册),故由
 *   本地 PartAlternate 表 ∪ DigiKey Substitutions 聚合而成,**每条都标注来源**。
 *
 * 配额纪律:ezPLM 有**日调用配额(429)**且 Nonce 一次性 ——
 * 详情查询必须过 ExternalPartSnapshot 缓存(SPEC §15),避免刷页面就烧配额。
 */
import { ProviderType, type Prisma } from "@prisma/client";
import { rankAlternates, type AlternateCandidate, type RankedAlternate } from "@/lib/domain/alternate-rank";
import { mergeFields, type MergedFields } from "@/lib/domain/field-merge";
import { packageAgreement } from "@/lib/domain/part-spec";
import { rankBySimilarity } from "@/lib/domain/similarity";
import { buildOfferCacheKey, CACHE_TTL_SECONDS } from "@/lib/providers/common/cache";
import { getDigiKeyProvider as getDk } from "@/lib/providers/digikey";
import { getMouserProvider } from "@/lib/providers/mouser";
import { ProviderError } from "@/lib/providers/common/errors";
import { normalizeMpn } from "@/lib/providers/common/mpn";
import { getDigiKeyProvider } from "@/lib/providers/digikey";
import { HttpEzplmProvider } from "@/lib/providers/ezplm/http";
import { ezplmProviderMode, MockEzplmProvider } from "@/lib/providers/ezplm";
import { getMasterDataProvider, masterDataMode } from "@/lib/providers/master-data";
import type {
  CanonicalPart,
  PartDocument,
  PartParameter,
} from "@/lib/providers/ezplm/types";
import type { EzplmReferenceDesign } from "@/lib/providers/ezplm/api-types";
import { effectiveDetailTtlSeconds } from "@/lib/providers/ezplm/file-token";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export type DetailSource = "ezplm" | "local-cache" | "mock";

export interface AlternateItem {
  mpn: string;
  manufacturer: string | null;
  /** 替代等级/说明;来源不同含义不同,故一并给出来源 */
  grade: string | null;
  note: string | null;
  source: "local" | "digikey";
}

export interface PartDetailView {
  mpn: string;
  part: CanonicalPart | null;
  parameters: PartParameter[];
  documents: PartDocument[];
  referenceDesigns: EzplmReferenceDesign[];
  alternates: RankedAlternate[];
  /** 本地缓存的库存/呆滞(ezPLM API 不提供库存查询) */
  inventory: { qtyOnHand: number; qtySlowMoving: number | null; fetchedAt: string } | null;
  /** 本地 BOM 用到该料的行数与 OPO 在途,便于判断影响面 */
  usage: { bomLines: number; openOpoQty: number };
  /** 采购记录(本系统 OPO 行,非 ERP 实时) */
  purchaseHistory: {
    poNo: string;
    lineNo: number;
    supplier: string;
    qtyOrdered: number;
    qtyOpen: number;
    unitPrice: string | null;
    currency: string | null;
    promiseDate: string | null;
  }[];
  source: DetailSource;
  /** 数据获取时间(注意:是抓取时间,非 ezPLM 侧的数据更新时间) */
  fetchedAt: string | null;
  /** 取数过程中的降级信息,如实展示不隐藏 */
  degraded: { provider: string; kind: string; message: string }[];
  /** 配置告警(如 http/多余路径) */
  configWarnings: string[];
  /**
   * 多源合并后的字段与来源。
   * ezPLM 覆盖面有限(白名单原厂库),缺的字段由分销商反查补上,
   * **每个字段都标来源** —— 客户给的和外部查的可信度完全不同。
   */
  fields: MergedFields;
}

/** 从分销商报价里取字段(用于回填 ezPLM 缺失的信息) */
async function distributorFacts(
  mpn: string,
): Promise<{ digikey: Record<string, unknown>; mouser: Record<string, unknown>; degraded: PartDetailView["degraded"] }> {
  const degraded: PartDetailView["degraded"] = [];
  const pick = (o: {
    manufacturer: string | null;
    description: string | null;
    packaging: string | null;
    lifecycle: string;
    rohs: boolean | null;
    reach: boolean | null;
  }) => ({
    manufacturer: o.manufacturer,
    description: o.description,
    packaging: o.packaging,
    lifecycle: o.lifecycle,
    rohs: o.rohs,
    reach: o.reach,
  });

  let digikey: Record<string, unknown> = {};
  let mouser: Record<string, unknown> = {};
  await Promise.all([
    (async () => {
      try {
        const offers = await getDk().getOffersByMpn({ mpn });
        if (offers[0]) digikey = pick(offers[0]);
      } catch (e) {
        degraded.push(toDegraded(e, "DIGIKEY"));
      }
    })(),
    (async () => {
      try {
        const offers = await getMouserProvider().getOffersByMpn({ mpn });
        if (offers[0]) mouser = pick(offers[0]);
      } catch (e) {
        degraded.push(toDegraded(e, "MOUSER"));
      }
    })(),
  ]);
  return { digikey, mouser, degraded };
}

function toDegraded(e: unknown, provider: string) {
  if (e instanceof ProviderError) return { provider: e.provider, kind: e.kind, message: e.message };
  return { provider, kind: "unknown", message: e instanceof Error ? e.message : String(e) };
}

/** 命中缓存则直接返回;否则调 ezPLM 并写缓存(配额保护) */
async function loadFromEzplmCached(
  tenantId: string,
  mpn: string,
): Promise<{
  payload: {
    part: CanonicalPart;
    parameters: PartParameter[];
    documents: PartDocument[];
    partlibId: string;
  } | null;
  fetchedAt: string;
  fromCache: boolean;
  configWarnings: string[];
  degraded: { provider: string; kind: string; message: string }[];
} | null> {
  if (ezplmProviderMode() !== "http") return null;

  const cacheKey = buildOfferCacheKey({
    provider: "EZPLM",
    site: null,
    currency: "-",
    mpn,
    manufacturer: null,
    quantity: null,
  });

  const cached = await prisma.externalPartSnapshot.findFirst({
    where: tenantWhere(tenantId, { source: ProviderType.EZPLM, cacheKey }),
  });
  if (cached && cached.expiresAt > new Date()) {
    return {
      payload: cached.payload as never,
      fetchedAt: cached.fetchedAt.toISOString(),
      fromCache: true,
      configWarnings: [],
      degraded: [],
    };
  }

  const provider = new HttpEzplmProvider({
    baseUrl: process.env.EZPLM_API_BASE_URL!,
    apiKey: process.env.EZPLM_API_KEY!,
  });

  try {
    const detail = await provider.getPartDetailByMpn(mpn);
    if (!detail) {
      return {
        payload: null,
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        configWarnings: provider.configWarnings,
        degraded: [],
      };
    }

    let referenceDesigns: EzplmReferenceDesign[] = [];
    try {
      referenceDesigns = await provider.getReferenceDesigns(detail.raw.id, 10);
    } catch (e) {
      // 参考设计失败不影响主体信息
      void e;
    }

    const payload = {
      part: detail.part,
      parameters: detail.parameters,
      documents: detail.documents,
      partlibId: detail.raw.id,
      referenceDesigns,
    };

    // 规格/文档属"规格类"数据,按 SPEC §15 用 24h TTL;
    // 但库文件地址是短时签名的(约 3h),TTL 必须被它压住 ——
    // 否则缓存还"新鲜",里面的符号/封装/3D 地址已经 401 了。
    const fetchedAt = new Date();
    const ttl = effectiveDetailTtlSeconds(
      CACHE_TTL_SECONDS.SPEC_LIFECYCLE_COMPLIANCE,
      detail.documents.map((d) => d.url),
      fetchedAt,
    );
    await prisma.externalPartSnapshot.upsert({
      where: {
        tenantId_source_cacheKey: { tenantId, source: ProviderType.EZPLM, cacheKey },
      },
      update: {
        payload: payload as unknown as Prisma.InputJsonValue,
        fetchedAt,
        ttlSeconds: ttl,
        expiresAt: new Date(fetchedAt.getTime() + ttl * 1000),
      },
      create: tenantData(tenantId, {
        source: ProviderType.EZPLM,
        cacheKey,
        payload: payload as unknown as Prisma.InputJsonValue,
        fetchedAt,
        ttlSeconds: ttl,
        expiresAt: new Date(fetchedAt.getTime() + ttl * 1000),
      }),
    });

    return {
      payload: payload as never,
      fetchedAt: fetchedAt.toISOString(),
      fromCache: false,
      configWarnings: provider.configWarnings,
      degraded: [],
    };
  } catch (e) {
    // ezPLM 不可用:回落到过期缓存(标注)或本地缓存表,并如实上报降级
    if (cached) {
      return {
        payload: cached.payload as never,
        fetchedAt: cached.fetchedAt.toISOString(),
        fromCache: true,
        configWarnings: provider.configWarnings,
        degraded: [toDegraded(e, "EZPLM")],
      };
    }
    return {
      payload: null,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      configWarnings: provider.configWarnings,
      degraded: [toDegraded(e, "EZPLM")],
    };
  }
}

/**
 * 替代料候选聚合 + 排序。
 *
 * 来源(客户要求的优先级):
 * 1. 本系统物料库:显式维护的替代关系,以及型号相似的自家料 —— 能直接下单;
 * 2. ezPLM 检索到的同系列型号;
 * 3. DigiKey Substitutions。
 *
 * 排序交给 lib/domain/alternate-rank.ts(纯函数):
 * 本系统优先 > 有现货 > 在产 > 性价比,且**相似度权重最高** ——
 * 便宜又有货但根本不像的料不是替代料。
 *
 * 配额纪律:不为每个候选单独打一次分销商接口(那会瞬间烧完配额)。
 * 库存/价格只用手头已有的数据,拿不到就是「未知」,由排序按中性处理。
 */
async function loadAlternates(
  tenantId: string,
  mpn: string,
  self: { footprint: string | null; lifecycle: string | null },
): Promise<{ items: RankedAlternate[]; degraded: PartDetailView["degraded"] }> {
  const degraded: PartDetailView["degraded"] = [];
  const candidates: AlternateCandidate[] = [];
  const seen = new Set<string>([normalizeMpn(mpn)]);

  const push = (c: AlternateCandidate) => {
    const key = normalizeMpn(c.mpn);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  /*
   * 封装是否可换:不比字符串,比**封装族 + 管脚数**。
   * `SOT-23-5` 与 `SOT-23-6` 字符串只差一位,但管脚数不同,焊上去会短路 ——
   * 管脚数不同一律判为不可换(见 lib/domain/part-spec.ts)。
   */
  const footprintMatchOf = (fp: string | null): boolean | null =>
    packageAgreement(self.footprint, fp).compatible;

  // 本地库:显式维护的替代关系(最可信)+ 型号相似的自家料
  const localParts = await prisma.part.findMany({ where: tenantWhere(tenantId), take: 5000 });
  const selfPart = localParts.find((p) => normalizeMpn(p.mpn ?? "") === normalizeMpn(mpn));
  if (selfPart) {
    const rows = await prisma.partAlternate.findMany({
      where: tenantWhere(tenantId, { partId: selfPart.id }),
      include: { alternatePart: true },
    });
    for (const r of rows) {
      push({
        mpn: r.alternatePart.mpn ?? r.alternatePart.internalPn,
        manufacturer: r.alternatePart.manufacturer,
        origin: "LOCAL",
        similarity: 1, // 人工维护的关系,不需要靠型号猜
        lifecycle: r.alternatePart.lifecycle,
        stock: null,
        unitPrice: null,
        currency: null,
        footprintMatches: footprintMatchOf(r.alternatePart.footprint),
      });
    }
  }

  const localRanked = rankBySimilarity(
    { value: mpn, footprint: self.footprint },
    localParts
      .filter((p) => p.mpn && normalizeMpn(p.mpn) !== normalizeMpn(mpn))
      .map((p) => ({
        mpn: p.mpn!,
        manufacturer: p.manufacturer,
        footprint: p.footprint,
        lifecycle: p.lifecycle,
      })),
    { limit: 5 },
  );
  for (const r of localRanked) {
    push({
      mpn: r.target.mpn,
      manufacturer: r.target.manufacturer ?? null,
      origin: "LOCAL",
      similarity: r.score.score,
      lifecycle: r.target.lifecycle,
      stock: null,
      unitPrice: null,
      currency: null,
      footprintMatches: footprintMatchOf(r.target.footprint ?? null),
    });
  }

  // 主数据源:同系列型号(F4:经 MasterDataProvider,真源随租户配置)
  if ((await masterDataMode(tenantId)).mode === "http") {
    try {
      const found = await (await getMasterDataProvider(tenantId)).searchParts({ keyword: mpn, limit: 20 });
      const ranked = rankBySimilarity(
        { value: mpn, footprint: self.footprint },
        found
          .filter((p): p is typeof p & { mpn: string } =>
            Boolean(p.mpn) && normalizeMpn(p.mpn ?? "") !== normalizeMpn(mpn),
          )
          .map((p) => ({
            mpn: p.mpn,
            manufacturer: p.manufacturer,
            footprint: p.footprint,
            lifecycle: p.lifecycle,
          })),
        { limit: 5 },
      );
      for (const r of ranked) {
        push({
          mpn: r.target.mpn,
          manufacturer: r.target.manufacturer ?? null,
          origin: "EZPLM",
          similarity: r.score.score,
          lifecycle: r.target.lifecycle,
          stock: null,
          unitPrice: null,
          currency: null,
          footprintMatches: footprintMatchOf(r.target.footprint ?? null),
        });
      }
    } catch (e) {
      degraded.push(toDegraded(e, "EZPLM"));
    }
  }

  // DigiKey Substitutions
  try {
    const subs = await getDigiKeyProvider().getSubstitutes(mpn);
    for (const s of subs) {
      push({
        mpn: s.mpn,
        manufacturer: s.manufacturer,
        origin: "DIGIKEY",
        similarity: 0.9, // 分销商标注的替代关系,可信度高于纯型号相似
        lifecycle: null,
        stock: null,
        unitPrice: null,
        currency: null,
        footprintMatches: null,
      });
    }
  } catch (e) {
    degraded.push(toDegraded(e, "DIGIKEY"));
  }

  return { items: rankAlternates(candidates, { limit: 8 }), degraded };
}

export async function getPartDetail(tenantId: string, mpn: string): Promise<PartDetailView> {
  const degraded: PartDetailView["degraded"] = [];
  let configWarnings: string[] = [];
  let source: DetailSource = "local-cache";
  let fetchedAt: string | null = null;
  let part: CanonicalPart | null = null;
  let parameters: PartParameter[] = [];
  let documents: PartDocument[] = [];
  let referenceDesigns: EzplmReferenceDesign[] = [];

  const ez = await loadFromEzplmCached(tenantId, mpn);
  if (ez) {
    configWarnings = ez.configWarnings;
    degraded.push(...ez.degraded);
    fetchedAt = ez.fetchedAt;
    if (ez.payload) {
      source = "ezplm";
      part = ez.payload.part;
      parameters = ez.payload.parameters;
      documents = ez.payload.documents;
      referenceDesigns =
        (ez.payload as unknown as { referenceDesigns?: EzplmReferenceDesign[] }).referenceDesigns ?? [];
    }
  } else {
    // 未配置凭据:走 Mock,页面会如实标注为示例数据
    const mock = new MockEzplmProvider();
    const hit = await mock.getPartByMpn({ mpn });
    if (hit) {
      source = "mock";
      part = hit;
      parameters = await mock.getParameters(hit.id);
      documents = await mock.getDocuments(hit.id);
      fetchedAt = hit.updatedAt;
    }
  }

  // ezPLM 无结果时回落本地缓存表(数据主权:本地是只读缓存)
  const local = await prisma.part.findFirst({ where: tenantWhere(tenantId, { mpn }) });
  if (!part && local) {
    source = "local-cache";
    part = {
      id: local.id,
      internalPn: local.internalPn,
      mpn: local.mpn,
      manufacturer: local.manufacturer,
      manufacturerId: null, // 本地缓存无 ezPLM 厂商 ID
      description: local.description,
      footprint: local.footprint,
      category: null, // 本地 Part 表没有分类字段;不猜
      lifecycle: local.lifecycle,
      rohs: local.rohs,
      reach: local.reach,
      msl: local.msl,
      packaging: local.packaging,
      dateCode: local.dateCode,
      updatedAt: (local.syncedAt ?? local.updatedAt).toISOString(),
    };
    fetchedAt = (local.syncedAt ?? local.updatedAt).toISOString();
  }

  const facts = await distributorFacts(mpn);
  degraded.push(...facts.degraded);

  /*
   * 字段优先级:本地库(已人工确认过的自家数据)> ezPLM(工程主数据)
   * > DigiKey > Mouser。只补空,不覆盖。
   */
  const fields = mergeFields([
    {
      name: "LOCAL",
      values: local
        ? {
            manufacturer: local.manufacturer,
            description: local.description,
            footprint: local.footprint,
            lifecycle: local.lifecycle,
            rohs: local.rohs,
            reach: local.reach,
            packaging: local.packaging,
            msl: local.msl,
          }
        : {},
    },
    {
      name: "EZPLM",
      values: part
        ? {
            manufacturer: part.manufacturer,
            description: part.description,
            footprint: part.footprint,
            lifecycle: part.lifecycle,
            rohs: part.rohs,
            reach: part.reach,
            packaging: part.packaging,
            msl: part.msl,
          }
        : {},
    },
    { name: "DIGIKEY", values: facts.digikey },
    { name: "MOUSER", values: facts.mouser },
  ]);

  const [alternates, inventory, bomLines, opoLines] = await Promise.all([
    loadAlternates(tenantId, mpn, {
      footprint: (fields.footprint.value as string | null) ?? null,
      lifecycle: (fields.lifecycle.value as string | null) ?? null,
    }),
    local
      ? prisma.inventorySnapshot.findFirst({
          where: tenantWhere(tenantId, { partId: local.id }),
          orderBy: { fetchedAt: "desc" },
        })
      : null,
    prisma.bOMLine.count({ where: tenantWhere(tenantId, { mpn }) }),
    prisma.oPOLine.findMany({
      where: tenantWhere(tenantId, { mpn }),
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
  ]);
  degraded.push(...alternates.degraded);

  // OPOLine 无 supplier 关系字段,按 id 批量取名
  const suppliers = opoLines.length
    ? await prisma.supplier.findMany({
        where: tenantWhere(tenantId, { id: { in: [...new Set(opoLines.map((l) => l.supplierId))] } }),
        select: { id: true, name: true },
      })
    : [];
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));

  return {
    mpn,
    part,
    parameters,
    documents,
    referenceDesigns,
    alternates: alternates.items,
    inventory: inventory
      ? {
          qtyOnHand: Number(inventory.qtyOnHand),
          qtySlowMoving:
            inventory.qtySlowMoving === null ? null : Number(inventory.qtySlowMoving),
          fetchedAt: inventory.fetchedAt.toISOString(),
        }
      : null,
    usage: {
      bomLines,
      openOpoQty: opoLines.reduce((s, l) => s + Number(l.qtyOpen), 0),
    },
    purchaseHistory: opoLines.map((l) => ({
      poNo: l.poNo,
      lineNo: l.lineNo,
      supplier: supplierNames.get(l.supplierId) ?? l.supplierId,
      qtyOrdered: Number(l.qtyOrdered),
      qtyOpen: Number(l.qtyOpen),
      unitPrice: l.unitPrice === null ? null : String(l.unitPrice),
      currency: l.currency,
      promiseDate: l.promiseDate ? l.promiseDate.toISOString().slice(0, 10) : null,
    })),
    source,
    fetchedAt,
    degraded,
    configWarnings,
    fields,
  };
}
