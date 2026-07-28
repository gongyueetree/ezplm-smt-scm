import { EzplmFileError, fetchEzplmFile } from "@/lib/server/ezplm-file";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { getPartDetail } from "@/lib/server/repositories/part-detail";

export const runtime = "nodejs";

const KINDS = new Set(["SYMBOL", "FOOTPRINT", "MODEL_3D", "DATASHEET"]);

const CONTENT_TYPE: Record<string, string> = {
  SYMBOL: "text/plain; charset=utf-8",
  FOOTPRINT: "text/plain; charset=utf-8",
  MODEL_3D: "application/step",
  DATASHEET: "application/pdf",
};

/**
 * 库文件代理。
 *
 * 为什么不让浏览器直接取 ezPLM 给的 URL:
 * 那个 URL 是**外部响应里的数据**,直接交给浏览器等于把跳转目标交给外部系统。
 * 这里由服务端按 kind 从(已缓存的)物料详情里**重新解析出 URL**,
 * 再过一遍 host 白名单,前端只认 kind —— 没有任何用户可控的地址进入 fetch。
 */
export async function GET(req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  if (!KINDS.has(kind)) return badRequest("kind 必须是 SYMBOL / FOOTPRINT / MODEL_3D / DATASHEET");

  const detail = await getPartDetail(auth.session.tenantId, mpn);
  const doc = detail.documents.find((d) => d.kind === kind);
  if (!doc?.url) return notFound(`该物料没有 ${kind} 文件`);

  try {
    const buf = await fetchEzplmFile(doc.url, { maxBytes: 24 * 1024 * 1024, timeoutMs: 30_000 });
    return new Response(buf, {
      headers: {
        "Content-Type": CONTENT_TYPE[kind] ?? "application/octet-stream",
        "Content-Length": String(buf.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        // 文件本身不含租户数据,但仍限私有缓存,避免共享代理缓存带 token 的内容
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    const message = e instanceof EzplmFileError ? e.message : "拉取库文件失败";
    return Response.json({ error: message }, { status: 502 });
  }
}
