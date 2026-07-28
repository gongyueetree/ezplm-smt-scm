import { notFound, requireSession } from "@/lib/server/api";
import { getStorageProvider } from "@/lib/server/storage";

export const runtime = "nodejs";

/**
 * 原始文件下载(本地存储实现的取回通道)。
 * 鉴权:必须有会话;且 key 必须以当前租户目录开头 —— 防跨租户下载。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { key } = await params;
  const fileKey = key.map(decodeURIComponent).join("/");

  // 存储键形如 <prefix>/<tenantId>/<uuid>-<hash><ext>
  if (!fileKey.includes(`/${auth.session.tenantId}/`)) {
    return notFound("文件不存在或不属于当前租户");
  }

  const buffer = await getStorageProvider().get(fileKey);
  if (!buffer) return notFound("文件不存在");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileKey.split("/").pop() ?? "download")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
