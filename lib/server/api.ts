/** Route Handler 公共:取会话、统一错误响应 */
import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/session";
import { getSession } from "@/lib/server/session";
import type { SessionRef } from "@/lib/server/repositories/rfq";

export async function requireSession(): Promise<
  { ok: true; session: SessionRef & SessionPayload } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  }
  return { ok: true, session };
}

export function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

export function notFound(message = "资源不存在或不属于当前租户") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function forbidden(message: string, code?: string) {
  return NextResponse.json({ error: message, code }, { status: 403 });
}

/**
 * E9:**中间件路径下的 multipart 接口必须在读 body 之前按 10MB 拒**。
 *
 * Next 为中间件克隆请求体的上限是 10MB,超出部分静默丢弃。被截断的
 * multipart 边界损坏后 `req.formData()` 抛错,路由的兜底会把它说成
 * 「需要 multipart/form-data」—— 实测 12.4MB 的 BOM 就是这个下场,
 * 用户明明传的就是表单文件,完全无从排查。
 *
 * 与其让框架截断后报一句错话,不如在这里先拒并说清楚:文件多大、上限多少、
 * 该拆分还是该走哪个入口。真正需要大文件的路由(/api/bom/import、/api/upload/)
 * 已从中间件豁免,不走本守卫。
 */
export function guardMultipartSize(req: Request): NextResponse | null {
  const raw = req.headers.get("content-length");
  const n = raw === null ? null : Number(raw);
  if (n === null || !Number.isFinite(n)) return null; // 无长度时交给后续解析;此类客户端极少
  const limit = 10 * 1024 * 1024;
  if (n <= limit) return null;
  return NextResponse.json(
    {
      error:
        `文件 ${(n / 1024 / 1024).toFixed(1)}MB,超过本入口 10MB 上限 —— ` +
        `超出部分会被框架静默截断,与其收下一份残缺数据不如现在拒绝。` +
        `请拆分文件后分批导入;大 BOM 请走「导入 BOM」页面(该通道无此限制)。`,
      code: "too_large",
    },
    { status: 413 },
  );
}
