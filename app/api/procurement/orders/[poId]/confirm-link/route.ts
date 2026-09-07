import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  buildConfirmUrl,
  EXPIRY_DAYS_DEFAULT,
  expiryFromDays,
  generateActionToken,
} from "@/lib/domain/supplier-action";
import { createPoConfirmRequest } from "@/lib/server/repositories/supplier-action";

export const runtime = "nodejs";

const Input = z.object({ expiryDays: z.number().int().min(1).max(60).default(EXPIRY_DAYS_DEFAULT) });

/**
 * F3:生成 PO 免登录确认链接。
 * 原始 token 只在本响应里出现一次;库里只有哈希。SMTP 未配置也能生成 ——
 * 链接可复制外发,发送状态与确认状态互不推导。
 */
export async function POST(req: Request, { params }: { params: Promise<{ poId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可生成确认链接");
  }
  const { poId } = await params;
  const parsed = Input.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return badRequest("参数不合法");

  const { raw, hash } = generateActionToken();
  const created = await createPoConfirmRequest(auth.session, {
    poId,
    tokenHash: hash,
    expiresAt: expiryFromDays(parsed.data.expiryDays),
  });
  if (!created.ok) return badRequest(created.reason);

  const link = buildConfirmUrl(raw, process.env.APP_PUBLIC_URL, process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  return NextResponse.json({
    url: link.url,
    absolute: link.absolute,
    note: link.absolute
      ? null
      : "APP_PUBLIC_URL 未配置 —— 这是相对路径,外发前请补全域名",
    expiresAt: expiryFromDays(parsed.data.expiryDays).toISOString(),
  });
}
