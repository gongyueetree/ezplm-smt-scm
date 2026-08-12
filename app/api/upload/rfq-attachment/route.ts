import { NextResponse } from "next/server";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import {
  checkContentLength,
  guessGerberKind,
  resolveMaxBytes,
  shouldParseAtUpload,
} from "@/lib/domain/attachment-limits";
import { addRfqAttachment } from "@/lib/server/repositories/rfq";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

const ATTACHMENT_TYPES = ["BOM", "GERBER", "PDF", "IMAGE", "PROCESS_DOC", "OTHER"] as const;
type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/**
 * E1b:**单文件流式上传**(客户 Q13:Gerber 上传导致死机)。
 *
 * ⚠️ 这个路由**刻意放在 `/api/upload/` 下,并在 middleware matcher 里排除**。
 *
 * 原因是实测出来的:项目的 middleware 匹配了 `/api/**`,而 Next 为了让中间件
 * 能读请求体,会把 body 克隆一份,**上限 10MB(`middlewareClientMaxBodySize`),
 * 超出部分静默丢弃**。表现是:传 30MB 的包,路由只收到 10485760 字节,
 * 却仍然返回 201「成功」—— 客户拿到的是一个**被截断的残档**。
 * 这比"上传失败"更糟,因为没人会发现。
 *
 * 中间件本身只读 cookie、根本不碰 body,所以排除它没有任何损失;
 * 鉴权仍由本路由的 `requireSession()` 把关 —— 那才是真正的门,
 * 中间件只是省一次往返的便利。
 *
 * 与旧的 multipart 入口的关键差别:
 *
 * 1. **先看 Content-Length 再读 body。** 旧实现 `await req.formData()`
 *    会把所有文件整个缓冲进内存,之后才检查上限 —— 传 200MB 就是
 *    先吃下 200MB 再说"超限"。容器内存有限,这一步足以打死进程。
 * 2. **流式落存储**,不在 Node 进程里驻留整份文件。
 * 3. **一次一个文件**,前端顺序上传 —— 这样进度、取消、重试都能落到单个文件上,
 *    也不会因为第 5 个文件失败而让前 4 个白传。
 * 4. **不解析**。Gerber 在 RFQ 阶段首先是要留档的客户文件,
 *    上传成功不等于必须立刻解析;把两者绑在一起正是卡死的根源之一。
 *
 * 文件名与类型走 query,body 是纯文件字节。
 */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const id = (url.searchParams.get("rfqId") ?? "").trim();
  if (!id) return badRequest("缺少 rfqId");
  const fileName = (url.searchParams.get("name") ?? "").trim();
  if (!fileName) return badRequest("缺少文件名(name 参数)");

  const rawType = url.searchParams.get("type") ?? "OTHER";
  const type: AttachmentType = (ATTACHMENT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as AttachmentType)
    : "OTHER";

  const limit = resolveMaxBytes(process.env.ATTACHMENT_MAX_MB);

  /*
   * ——— 这一段必须在 `req.body` 之前 ———
   * 一旦开始读 body,大小就已经进内存了,再拒绝也晚了。
   */
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
        limitIsDefault: limit.usedDefault,
      },
      { status: 413 },
    );
  }

  if (!req.body) return badRequest("请求没有文件内容");

  const storage = getStorageProvider();
  const stored = await storage.putStream(fileName, req.body, {
    contentType: req.headers.get("content-type") || "application/octet-stream",
    prefix: `rfq-attachments/${auth.session.tenantId}`,
    contentLength: sizeCheck.bytes ?? undefined,
  });

  /*
   * 收到的字节数必须与 Content-Length 一致。
   *
   * 这条不是形式主义:上面那个 10MB 静默截断就是这么发现的 ——
   * 存储层老老实实写完了它收到的全部内容,而它收到的本身就少了。
   * 少一个字节的 zip 就是打不开的 zip,**宁可让上传失败,也不能留下残档**。
   * 出错时把已写入的对象删掉,不留半截文件占位。
   */
  if (sizeCheck.bytes !== null && stored.sizeBytes !== sizeCheck.bytes) {
    await storage.delete(stored.key).catch(() => {
      /* 清理失败不掩盖原始错误 */
    });
    return NextResponse.json(
      {
        error:
          `上传内容不完整:声明 ${sizeCheck.bytes} 字节,实际只收到 ${stored.sizeBytes} 字节。` +
          `文件**没有保存**(残缺的压缩包比没有更糟)。请重试;若反复出现,请把文件大小反馈给我们。`,
        code: "incomplete_body",
        declaredBytes: sizeCheck.bytes,
        receivedBytes: stored.sizeBytes,
      },
      { status: 502 },
    );
  }

  const kind = guessGerberKind(fileName);
  const att = await addRfqAttachment(auth.session, {
    rfqId: id,
    // 文件名认出是 Gerber/压缩包时自动打标,省得人每次手选
    type: type === "OTHER" && kind !== "OTHER" ? "GERBER" : type,
    fileName,
    fileKey: stored.key,
    sizeBytes: stored.sizeBytes || (sizeCheck.bytes ?? 0),
    contentType: stored.contentType,
    processState: "UPLOADED_NOT_PARSED",
    processNote: shouldParseAtUpload()
      ? null
      : kind === "GERBER" || kind === "ARCHIVE"
        ? "已完整保存原始文件。系统在 RFQ 阶段**不解析** Gerber —— 它首先是要留档的客户文件。"
        : "已完整保存原始文件,上传阶段不做内容解析。",
  });
  if (!att) return notFound("RFQ 不存在或不属于当前租户");

  return NextResponse.json(
    {
      attachment: att,
      maxMb: limit.maxMb,
      limitNote: limit.reason,
      note: "已保存原始文件;**未做内容解析** —— 保存成功不代表系统读懂了它。",
    },
    { status: 201 },
  );
}
