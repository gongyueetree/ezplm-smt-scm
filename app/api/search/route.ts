import { NextResponse } from "next/server";
import { badRequest, requireSession } from "@/lib/server/api";
import {
  SEARCH_ENTITY_LABEL,
  normalizeQuery,
  searchEntitiesFor,
  type SearchEntity,
} from "@/lib/domain/search-scopes";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** 每类实体最多返回几条 —— 截断要明说,不静默 */
const PER_TYPE = 5;

interface Hit {
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * F1:全局搜索(SPEC §3 的 SEARCH_SCOPES 落地)。
 *
 * - 范围由**服务端按会话角色**决定(searchEntitiesFor),不接受客户端指定;
 * - 每类 take PER_TYPE+1,超出置 truncated —— 用户要知道"还有,不止这些";
 * - ECN 实体在 F2 上线前如实返回空组并注明,**不假装搜过了没有**;
 * - 所有查询 tenantWhere,一条不例外。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const nq = normalizeQuery(new URL(req.url).searchParams.get("q"));
  if (!nq.ok) return badRequest(nq.message);
  const { q } = nq;
  const tenantId = auth.session.tenantId;
  const contains = { contains: q, mode: "insensitive" as const };

  const entities = searchEntitiesFor(auth.session.roles);
  if (entities.length === 0) {
    return NextResponse.json({
      groups: [],
      note: "当前角色未开放内部搜索(供应商侧协同随门户提供)",
    });
  }

  const runners: Record<SearchEntity, () => Promise<{ hits: Hit[]; truncated: boolean; note?: string }>> = {
    BOM: async () => {
      const rows = await prisma.bOM.findMany({
        where: tenantWhere(tenantId, { name: contains }),
        include: { versions: { orderBy: { versionNo: "desc" }, take: 1, select: { id: true } } },
        take: PER_TYPE + 1,
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((b) => ({
          title: b.name,
          subtitle: b.purpose === "PRODUCTION" ? "正式 BOM" : "预 BOM",
          href: b.versions[0] ? `/bom/version/${b.versions[0].id}` : "/bom",
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    PART: async () => {
      const rows = await prisma.part.findMany({
        where: tenantWhere(tenantId, { OR: [{ internalPn: contains }, { mpn: contains }] }),
        take: PER_TYPE + 1,
        select: { internalPn: true, mpn: true, manufacturer: true },
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((p) => ({
          title: p.internalPn,
          subtitle: [p.manufacturer, p.mpn].filter(Boolean).join(" · ") || null,
          href: p.mpn ? `/materials/${encodeURIComponent(p.mpn)}` : "/materials",
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    ECN: async () => ({
      hits: [],
      truncated: false,
      note: "ECN 模块随 Round2 F2 上线 —— 此范围暂无可搜内容(不是没搜到)",
    }),
    SUPPLIER: async () => {
      const rows = await prisma.supplier.findMany({
        where: tenantWhere(tenantId, { OR: [{ name: contains }, { code: contains }] }),
        take: PER_TYPE + 1,
        select: { name: true, code: true },
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((s) => ({
          title: s.name,
          subtitle: s.code,
          href: "/procurement/suppliers",
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    PROCUREMENT_RFQ: async () => {
      const rows = await prisma.procurementRFQ.findMany({
        where: tenantWhere(tenantId, { code: contains }),
        take: PER_TYPE + 1,
        select: { id: true, code: true },
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((r) => ({
          title: r.code,
          subtitle: "比价单",
          href: `/procurement/rfq/${r.id}`,
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    PO: async () => {
      const rows = await prisma.purchaseOrder.findMany({
        where: tenantWhere(tenantId, { poNo: contains }),
        take: PER_TYPE + 1,
        select: { poNo: true, status: true },
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((p) => ({
          title: p.poNo,
          subtitle: `采购单 · ${p.status}`,
          href: "/procurement/orders",
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    OPO: async () => {
      const rows = await prisma.oPOLine.findMany({
        where: tenantWhere(tenantId, { OR: [{ poNo: contains }, { mpn: contains }] }),
        take: PER_TYPE + 1,
        select: { poNo: true, mpn: true },
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((l) => ({
          title: l.poNo,
          subtitle: l.mpn,
          href: "/suppliers/opo",
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    RFQ: async () => {
      const rows = await prisma.rFQ.findMany({
        where: tenantWhere(tenantId, { OR: [{ code: contains }, { title: contains }] }),
        take: PER_TYPE + 1,
        select: { id: true, code: true, title: true },
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((r) => ({
          title: r.code,
          subtitle: r.title,
          href: `/rfq/${r.id}`,
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    CUSTOMER: async () => {
      const rows = await prisma.customer.findMany({
        where: tenantWhere(tenantId, { OR: [{ name: contains }, { code: contains }] }),
        take: PER_TYPE + 1,
        select: { id: true, name: true, code: true },
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((c) => ({
          title: c.name,
          subtitle: c.code,
          href: `/inventory?customerId=${c.id}`,
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
    QUOTE: async () => {
      const rows = await prisma.quote.findMany({
        where: tenantWhere(tenantId, { code: contains }),
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { id: true, status: true } } },
        take: PER_TYPE + 1,
      });
      return {
        hits: rows.slice(0, PER_TYPE).map((qt) => ({
          title: qt.code,
          subtitle: qt.versions[0] ? `最新版本 ${qt.versions[0].status}` : null,
          href: qt.versions[0] ? `/quotes/${qt.versions[0].id}` : "/quotes",
        })),
        truncated: rows.length > PER_TYPE,
      };
    },
  };

  const groups = await Promise.all(
    entities.map(async (e) => {
      const r = await runners[e]();
      return { type: e, label: SEARCH_ENTITY_LABEL[e], ...r };
    }),
  );

  return NextResponse.json({
    groups: groups.filter((g) => g.hits.length > 0 || g.note),
    scopes: entities.map((e) => SEARCH_ENTITY_LABEL[e]),
  });
}
