import { NextResponse } from "next/server";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { addRfqAttachment } from "@/lib/server/repositories/rfq";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

const ATTACHMENT_TYPES = ["BOM", "GERBER", "PDF", "IMAGE", "PROCESS_DOC", "OTHER"] as const;
type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** 单文件上限 20MB(原始客户文件需保留,过大文件走线下交换) */
const MAX_BYTES = 20 * 1024 * 1024;

/** 多文件上传:保留原始客户文件并标记附件类型(SPEC §5) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("需要 multipart/form-data");

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return badRequest("未选择文件");

  const rawType = String(form.get("type") ?? "OTHER");
  const type: AttachmentType = (ATTACHMENT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as AttachmentType)
    : "OTHER";

  const storage = getStorageProvider();
  const saved = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return badRequest(`文件 ${file.name} 超过 20MB 上限`);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storage.put(file.name, buffer, {
      contentType: file.type || "application/octet-stream",
      prefix: `rfq-attachments/${auth.session.tenantId}`,
    });
    const att = await addRfqAttachment(auth.session, {
      rfqId: id,
      type,
      fileName: file.name,
      fileKey: stored.key,
      sizeBytes: stored.sizeBytes,
      contentType: stored.contentType,
    });
    if (!att) return notFound();
    saved.push(att);
  }

  return NextResponse.json({ attachments: saved }, { status: 201 });
}
