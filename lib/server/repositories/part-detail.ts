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
import { buildOfferCacheKey, CACHE_TTL_SECONDS } from "@/lib/providers/common/cache";
import { ProviderError } from "@/lib/providers/common/errors";
import { normalizeMpn } from "@/lib/providers/common/mpn";
import { getDigiKeyProvider } from "@/lib/providers/digikey";
import { HttpEzplmProvider } from "@/lib/providers/ezplm/http";
import { ezplmProviderMode, MockEzplmProvider } from "@/lib/providers/ezplm";
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
  alternates: AlternateItem[];
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

/** 替代料聚合:本地维护 ∪ DigiKey Substitutions,每条标来源 */
async function loadAlternates(
  tenantId: string,
  mpn: string,
): Promise<{ items: AlternateItem[]; degraded: { provider: string; kind: string; message: string }[] }> {
  const degraded: { provider: string; kind: string; message: string }[] = [];
  const items: AlternateItem[] = [];

  // 本地 PartAlternate
  const part = await prisma.part.findFirst({
    where: tenantWhere(tenantId, { mpn }),
    select: { id: true },
  });
  if (part) {
    const rows = await prisma.partAlternate.findMany({
      where: tenantWhere(tenantId, { partId: part.id }),
      include: { alternatePart: { select: { mpn: true, manufacturer: true } } },
    });
    for (const r of rows) {
      items.push({
        mpn: r.alternatePart.mpn ?? "(无 MPN)",
        manufacturer: r.alternatePart.manufacturer,
        grade: r.grade,
        note: r.note,
        source: "local",
      });
    }
  }

  // DigiKey Substitutions
  try {
    const dk = getDigiKeyProvider();
    const subs = await dk.getSubstitutes(mpn);
    for (const s of subs) {
      if (items.some((i) => normalizeMpn(i.mpn) === normalizeMpn(s.mpn))) continue;
      items.push({
        mpn: s.mpn,
        manufacturer: s.manufacturer,
        grade: null,
        note: s.description,
        source: "digikey",
      });
    }
  } catch (e) {
    degraded.push(toDegraded(e, "DIGIKEY"));
  }

  return { items, degraded };
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
      description: local.description,
      footprint: local.footprint,
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

  const [alternates, inventory, bomLines, opoLines] = await Promise.all([
    loadAlternates(tenantId, mpn),
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
  };
}
