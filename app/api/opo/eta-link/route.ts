import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  buildConfirmUrl,
  EXPIRY_DAYS_DEFAULT,
  expiryFromDays,
  generateActionToken,
} from "@/lib/domain/supplier-action";
import { createOpoEtaRequest } from "@/lib/server/repositories/supplier-action";

export const runtime = "nodejs";

const Input = z.object({
  supplierId: z.string().min(1),
  expiryDays: z.number().int().min(1).max(60).default(EXPIRY_DAYS_DEFAULT),
});

/** F3:生成该供应商未交 OPO 行的交期确认链接(免登录;落 OPOReply source=LINK) */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可生成确认链接");
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const { raw, hash } = generateActionToken();
  const created = await createOpoEtaRequest(auth.session, {
    supplierId: parsed.data.supplierId,
    tokenHash: hash,
    expiresAt: expiryFromDays(parsed.data.expiryDays),
  });
  if (!created.ok) return badRequest(created.reason);

  const link = buildConfirmUrl(raw, process.env.APP_PUBLIC_URL, process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  return NextResponse.json({
    url: link.url,
    absolute: link.absolute,
    openLines: created.openLines,
    note: link.absolute ? null : "APP_PUBLIC_URL 未配置 —— 这是相对路径,外发前请补全域名",
  });
}
