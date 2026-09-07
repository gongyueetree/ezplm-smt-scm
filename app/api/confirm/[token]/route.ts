import { NextResponse } from "next/server";
import {
  OpoEtaResponseSchema,
  PoConfirmResponseSchema,
} from "@/lib/domain/supplier-action";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { respondOpoEta, respondPoConfirm } from "@/lib/server/repositories/supplier-action";

export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  not_found: 404,
  expired: 410,
  already_responded: 409,
  invalid: 400,
};

/**
 * F3:公开提交(免登录;鉴权 = token 本身)。
 * 速率限制:每 IP 每分钟 30 次(单实例兜底,见 lib/server/rate-limit.ts)。
 * 未知 token 一律 404,与不存在不可区分。
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  if (!rateLimit(`confirm:${ip ?? "unknown"}`, 30, 60_000)) {
    return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });
  }

  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: "链接无效" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { kind?: string } | null;
  const meta = { ip, ua: req.headers.get("user-agent") };

  if (body && body.kind === "PO_CONFIRM") {
    const parsed = PoConfirmResponseSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
    const r = await respondPoConfirm(token, parsed.data, meta);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: STATUS[r.code] ?? 400 });
    return NextResponse.json({ ok: true });
  }
  if (body && body.kind === "OPO_ETA") {
    const parsed = OpoEtaResponseSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });
    const r = await respondOpoEta(token, parsed.data, meta);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: STATUS[r.code] ?? 400 });
    return NextResponse.json({ ok: true, savedLines: r.savedLines });
  }
  return NextResponse.json({ error: "参数不合法" }, { status: 400 });
}
