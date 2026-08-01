import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/api";
import { expiryBucket, summarizeCompliance } from "@/lib/domain/doc-expiry";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/** 合规文档有效期预警(客户 docx:ROHS/REACH/COC 的管控) */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const [docs, parts] = await Promise.all([
    prisma.partDocument.findMany({
      where: tenantWhere(auth.session.tenantId),
      select: { partId: true, kind: true, validUntil: true, fileName: true },
      take: 5000,
    }),
    prisma.part.findMany({
      where: tenantWhere(auth.session.tenantId),
      select: { id: true, internalPn: true },
      take: 5000,
    }),
  ]);

  const pnById = new Map(parts.map((p) => [p.id, p.internalPn]));
  const asOf = new Date().toISOString();
  const refs = docs.map((d) => ({
    partId: d.partId,
    internalPn: pnById.get(d.partId) ?? "",
    kind: d.kind,
    validUntil: d.validUntil?.toISOString() ?? null,
  }));

  return NextResponse.json({
    summary: summarizeCompliance(refs, parts.map((p) => p.id), asOf),
    urgent: refs
      .map((r, i) => ({ ...r, fileName: docs[i].fileName, bucket: expiryBucket(r.validUntil, asOf) }))
      .filter((r) => r.bucket === "已过期" || r.bucket === "30天内到期")
      .slice(0, 200),
    asOf,
  });
}
