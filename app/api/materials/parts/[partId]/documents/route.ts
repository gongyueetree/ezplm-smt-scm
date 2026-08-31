import { NextResponse } from "next/server";
import { badRequest, guardMultipartSize, notFound, requireSession } from "@/lib/server/api";
import { DOC_KIND_LABEL } from "@/lib/domain/doc-expiry";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { requirePermission } from "@/lib/server/permissions";
import { getStorageProvider } from "@/lib/server/storage";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = ["DATASHEET", "APPROVAL_SHEET", "ROHS_REPORT", "REACH_REPORT", "COC", "OTHER"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ partId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { partId } = await params;
  const docs = await prisma.partDocument.findMany({
    where: tenantWhere(auth.session.tenantId, { partId }),
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    documents: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      kindLabel: DOC_KIND_LABEL[d.kind] ?? d.kind,
      fileName: d.fileName,
      sizeBytes: d.sizeBytes,
      version: d.version,
      validUntil: d.validUntil?.toISOString() ?? null,
      source: d.source,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

/**
 * 上传物料文档。文件本体走 FileStorageProvider,**库里只存 key 与元数据**。
 * 有效期留空即「未标注有效期」—— UI 会按告警显示,不当成长期有效。
 */
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

  // E9:读 body 之前先按中间件 10MB 上限拒 —— 截断后的报错会误导人(见 guardMultipartSize)
  const oversize = guardMultipartSize(req);
  if (oversize) return oversize;
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("未选择文件");
  if (file.size > MAX_BYTES) return badRequest("单文件不得超过 10 MB");

  const kindRaw = String(form.get("kind") ?? "OTHER");
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "OTHER";
  const validUntilRaw = String(form.get("validUntil") ?? "").trim();
  const version = String(form.get("version") ?? "").trim() || null;

  let validUntil: Date | null = null;
  if (validUntilRaw) {
    const t = Date.parse(`${validUntilRaw}T00:00:00.000Z`);
    if (!Number.isFinite(t)) return badRequest("有效期格式不正确(需 2027-06-30 形式)");
    validUntil = new Date(t);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await getStorageProvider().put(file.name, buffer, {
    contentType: file.type || "application/octet-stream",
    prefix: `part-documents/${auth.session.tenantId}`,
  });

  const doc = await prisma.$transaction(async (tx) => {
    const row = await tx.partDocument.create({
      data: tenantData(auth.session.tenantId, {
        partId,
        kind: kind as (typeof KINDS)[number],
        fileKey: stored.key,
        fileName: file.name,
        mimeType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        version,
        validUntil,
        source: "UPLOAD",
        uploadedById: auth.session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "PART_DOCUMENT_UPLOAD",
      entityType: "PartDocument",
      entityId: row.id,
      after: { partId, kind, fileName: file.name, validUntil: validUntilRaw || null },
    });
    return row;
  });

  return NextResponse.json(
    {
      id: doc.id,
      note: validUntil ? null : "未填写有效期 —— 该文档将显示为「未标注有效期」,不视为长期有效",
    },
    { status: 201 },
  );
}
