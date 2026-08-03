import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { summarizeDeclarations } from "@/lib/domain/compliance-declaration";
import { requirePermission } from "@/lib/server/permissions";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  scheme: z.string().trim().min(1).max(40),
  verdict: z.enum(["COMPLIANT", "NON_COMPLIANT", "NOT_APPLICABLE", "UNKNOWN"]),
  version: z.string().trim().max(30).nullable().optional(),
  standard: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  issuedAt: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  /** 支撑文档 id —— 一个声明可由多份文档支撑 */
  documentIds: z.array(z.string().min(1)).max(20).optional(),
});

/**
 * 合规**声明**(与支撑文档分离)。
 *
 * 一个布尔值承载不了"凭哪份文档、什么版本、谁审的、何时到期、是否不适用",
 * 而客户审厂时问的恰恰是这些。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { partId } = await params;

  const rows = await prisma.partComplianceDeclaration.findMany({
    where: tenantWhere(auth.session.tenantId, { partId }),
    include: { documents: { select: { documentId: true } } },
    orderBy: { issuedAt: "desc" },
  });

  const asOf = new Date().toISOString();
  const declarations = rows.map((d) => ({
    id: d.id,
    scheme: d.scheme,
    verdict: d.verdict,
    state: d.state,
    version: d.version,
    standard: d.standard,
    issuedAt: d.issuedAt?.toISOString() ?? null,
    validUntil: d.validUntil?.toISOString() ?? null,
    evidenceCount: d.documents.length,
    documentIds: d.documents.map((x) => x.documentId),
  }));

  return NextResponse.json({
    declarations,
    // 生效结论:未审核的、过期的、无依据的都会被降级为 UNKNOWN 并说明原因
    summary: summarizeDeclarations(declarations, asOf),
    asOf,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "material.create");
  if (!perm.ok) return perm.response;

  const { partId } = await params;
  const part = await prisma.part.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: partId }),
    select: { id: true },
  });
  if (!part) return notFound();

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const created = await prisma.$transaction(async (tx) => {
    const decl = await tx.partComplianceDeclaration.create({
      data: tenantData(auth.session.tenantId, {
        partId,
        scheme: parsed.data.scheme.toUpperCase(),
        verdict: parsed.data.verdict,
        version: parsed.data.version ?? null,
        standard: parsed.data.standard ?? null,
        note: parsed.data.note ?? null,
        issuedAt: parsed.data.issuedAt ? new Date(parsed.data.issuedAt) : null,
        validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
        // 新建一律 DRAFT —— 声明必须经审核才生效
        state: "DRAFT",
        createdById: auth.session.userId,
      }),
    });

    for (const documentId of parsed.data.documentIds ?? []) {
      const doc = await tx.partDocument.findFirst({
        where: tenantWhere(auth.session.tenantId, { id: documentId }),
        select: { id: true },
      });
      if (!doc) continue;
      await tx.partComplianceEvidence.create({
        data: tenantData(auth.session.tenantId, {
          declarationId: decl.id,
          documentId,
          createdById: auth.session.userId,
        }),
      });
    }

    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "COMPLIANCE_DECLARATION_CREATE",
      entityType: "PartComplianceDeclaration",
      entityId: decl.id,
      after: { partId, scheme: decl.scheme, verdict: decl.verdict },
    });
    return decl;
  });

  return NextResponse.json(
    {
      id: created.id,
      state: created.state,
      // 诚实提示:刚建的声明不生效
      note: "声明已创建但**尚未审核**,当前不作数 —— 审核通过后才会计入生效结论",
    },
    { status: 201 },
  );
}
