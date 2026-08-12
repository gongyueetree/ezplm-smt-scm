import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import {
  FUNCTIONAL_VALUES,
  PACKAGE_VALUES,
  PIN_VALUES,
  matchesPreset,
  rankByCompatibility,
  type AlternateFilterPreset,
  type CompatibilityTriple,
} from "@/lib/domain/alternate-compat";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** 一次最多返回的替代关系数;超过时**明说**被截断 */
const CAP = 500;

const PRESETS = [
  "FUNC_SAME_PKG_SAME",
  "FUNC_SAME_PKG_MINOR",
  "FUNC_SAME_NOT_PIN",
  "PIN_TO_PIN_ONLY",
] as const;

/**
 * E2:已维护的替代关系(三维兼容性)。
 *
 * 与 `/api/materials/[mpn]/alternates` 的**候选检索**是两回事:
 * 那边是"帮你找找看",这里是"已经核过、写下来的结论"。
 * 两者混在一起会让人分不清哪些是系统猜的、哪些是工程拍过板的。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawPreset = url.searchParams.get("preset");
  const preset = (PRESETS as readonly string[]).includes(rawPreset ?? "")
    ? (rawPreset as AlternateFilterPreset)
    : null;
  const q = (url.searchParams.get("q") ?? "").trim();

  const rows = await prisma.partAlternate.findMany({
    where: tenantWhere(auth.session.tenantId),
    include: {
      part: { select: { internalPn: true, mpn: true, manufacturer: true } },
      alternatePart: { select: { internalPn: true, mpn: true, manufacturer: true } },
    },
    orderBy: { createdAt: "desc" },
    take: CAP + 1,
  });
  const truncated = rows.length > CAP;

  const mapped = rows.slice(0, CAP).map((r) => ({
    item: {
      id: r.id,
      basePn: r.part.internalPn,
      baseMpn: r.part.mpn,
      baseMfg: r.part.manufacturer,
      altPn: r.alternatePart.internalPn,
      altMpn: r.alternatePart.mpn,
      altMfg: r.alternatePart.manufacturer,
      reason: r.reason,
      evidenceSource: r.evidenceSource,
      approvedById: r.approvedById,
      note: r.note,
    },
    compat: {
      functional: r.functionalEquivalence,
      packageCompat: r.packageCompatibility,
      pin: r.pinCompatibility,
    } as CompatibilityTriple,
  }));

  const searched = q
    ? mapped.filter((m) =>
        [m.item.basePn, m.item.baseMpn, m.item.altPn, m.item.altMpn]
          .filter(Boolean)
          .some((v) => v!.toUpperCase().includes(q.toUpperCase())),
      )
    : mapped;

  const ranked = rankByCompatibility(searched, { preset });

  /*
   * 三维取值**随结果一起回传**。
   * 不要让前端从结论字符串里反解 —— 标签之间存在子串碰撞
   * (「功能完全一致」与「封装完全一致」都含「完全一致」),
   * 而且解析器一改措辞前端就跟着错。这正是 CLAUDE.md 禁止的裸 includes 判定。
   */
  const compatById = new Map(searched.map((x) => [x.item.id, x.compat]));
  const withCompat = ranked.map((r) => ({ ...r, compat: compatById.get(r.item.id) ?? null }));

  return NextResponse.json({
    items: withCompat,
    total: searched.length,
    matched: ranked.length,
    preset,
    truncated,
    truncationNote: truncated
      ? `替代关系超过 ${CAP} 条,本次只统计了最近 ${CAP} 条 —— 不是"只有这些"。`
      : null,
  });
}

const Input = z.object({
  basePartId: z.string().min(1),
  alternatePartId: z.string().min(1),
  functionalEquivalence: z.enum(FUNCTIONAL_VALUES as [string, ...string[]]),
  packageCompatibility: z.enum(PACKAGE_VALUES as [string, ...string[]]),
  pinCompatibility: z.enum(PIN_VALUES as [string, ...string[]]),
  reason: z.string().max(500).nullable().optional(),
  evidenceSource: z.string().max(32).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** 维护一条替代关系(工程/PM/管理层) */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "ENGINEERING" || r === "PM" || r === "MANAGEMENT")) {
    return forbidden("替代关系由工程维护", "alternate_role");
  }

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });
  const d = parsed.data;

  if (d.basePartId === d.alternatePartId) {
    return badRequest("基准料与替代料不能是同一颗");
  }

  const parts = await prisma.part.findMany({
    where: tenantWhere(auth.session.tenantId, { id: { in: [d.basePartId, d.alternatePartId] } }),
    select: { id: true },
  });
  if (parts.length !== 2) return notFound("基准料或替代料不存在或不属于当前租户");

  const row = await prisma.partAlternate.upsert({
    where: {
      tenantId_partId_alternatePartId: {
        tenantId: auth.session.tenantId,
        partId: d.basePartId,
        alternatePartId: d.alternatePartId,
      },
    },
    update: {
      functionalEquivalence: d.functionalEquivalence as never,
      packageCompatibility: d.packageCompatibility as never,
      pinCompatibility: d.pinCompatibility as never,
      reason: d.reason ?? null,
      evidenceSource: d.evidenceSource ?? null,
      note: d.note ?? null,
      approvedById: auth.session.userId,
      approvedAt: new Date(),
    },
    create: tenantData(auth.session.tenantId, {
      partId: d.basePartId,
      alternatePartId: d.alternatePartId,
      functionalEquivalence: d.functionalEquivalence as never,
      packageCompatibility: d.packageCompatibility as never,
      pinCompatibility: d.pinCompatibility as never,
      reason: d.reason ?? null,
      evidenceSource: d.evidenceSource ?? null,
      note: d.note ?? null,
      approvedById: auth.session.userId,
      approvedAt: new Date(),
    }),
  });

  await writeAudit(prisma, {
    tenantId: auth.session.tenantId,
    userId: auth.session.userId,
    action: "PART_ALTERNATE_UPSERT",
    entityType: "PartAlternate",
    entityId: row.id,
    after: {
      functional: d.functionalEquivalence,
      package: d.packageCompatibility,
      pin: d.pinCompatibility,
      reason: d.reason ?? null,
    },
  });

  const compat: CompatibilityTriple = {
    functional: d.functionalEquivalence as CompatibilityTriple["functional"],
    packageCompat: d.packageCompatibility as CompatibilityTriple["packageCompat"],
    pin: d.pinCompatibility as CompatibilityTriple["pin"],
  };

  return NextResponse.json(
    {
      alternate: row,
      matchesPresets: PRESETS.filter((p) => matchesPreset(compat, p)),
      note:
        d.functionalEquivalence === "UNKNOWN"
          ? "已保存。功能一致性标为「未知」—— 它不会出现在任何「功能一致」的筛选里,不知道不等于符合。"
          : "已保存。",
    },
    { status: 201 },
  );
}
