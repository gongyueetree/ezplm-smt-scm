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
