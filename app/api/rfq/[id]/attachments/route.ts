import { NextResponse } from "next/server";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import {
  checkContentLength,
  effectiveLimitBehindMiddleware,
  resolveMaxBytes,
} from "@/lib/domain/attachment-limits";
import { addRfqAttachment } from "@/lib/server/repositories/rfq";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

const ATTACHMENT_TYPES = ["BOM", "GERBER", "PDF", "IMAGE", "PROCESS_DOC", "OTHER"] as const;
type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/*
 * E1b:上限改为**可配置**(ATTACHMENT_MAX_MB,默认 100MB)。
 * 20MB 对 Gerber 包不够 —— 客户原话「gerber 无固定大小」。
 *
 * 更要紧的是**校验时机**:下面在 `req.formData()` 之前先看 Content-Length。
 * 旧实现是先 formData 把所有文件缓冲进内存、之后才比大小 ——
 * 传 200MB 就是先吃下 200MB 再说"超限",容器内存扛不住就是客户说的"死机"。
 *
 * 大文件(尤其 Gerber)建议走 `POST .../attachments/upload` 流式单文件入口。
 */

/** 多文件上传:保留原始客户文件并标记附件类型(SPEC §5) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const configured = resolveMaxBytes(process.env.ATTACHMENT_MAX_MB);
  /*
   * 这个入口**在 middleware 路径下**,Next 克隆 body 的上限是 10MB,
   * 超出部分静默丢弃(服务端日志会打印 "Only the first 10MB will be available")。
   * 所以这里按 10MB 封顶 —— 放行 100MB 却在 10MB 处截断,
   * 等于给用户一个能"成功"的残档,比拒绝糟得多。
   * 大文件走 `/api/upload/rfq-attachment`,那条路已从 matcher 排除。
   */
  const maxMb = effectiveLimitBehindMiddleware(configured.maxMb);
  const limit = { maxMb, maxBytes: maxMb * 1024 * 1024 };
  // ——— 必须在 formData() 之前 ———
  const sizeCheck = checkContentLength(
    req.headers.get("content-length"),
    limit.maxBytes,
    limit.maxMb,
  );
  if (!sizeCheck.ok) {
    return NextResponse.json(
      {
        error: sizeCheck.message,
        code: sizeCheck.code,
        maxMb: limit.maxMb,
        hint:
          "大文件请用「逐个流式上传」入口(页面上的「上传附件」按钮已经走它)—— " +
          "本入口在中间件路径下,超过 10MB 的部分会被框架静默丢弃,所以按 10MB 封顶。",
      },
      { status: 413 },
    );
  }

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
    if (file.size > limit.maxBytes) {
      return badRequest(`文件 ${file.name} 超过 ${limit.maxMb}MB 上限`);
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
