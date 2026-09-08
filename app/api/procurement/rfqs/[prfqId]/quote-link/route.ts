import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  buildConfirmUrl,
  EXPIRY_DAYS_DEFAULT,
  expiryFromDays,
  generateActionToken,
} from "@/lib/domain/supplier-action";
import { createRfqQuoteRequest } from "@/lib/server/repositories/supplier-action";

export const runtime = "nodejs";

const Input = z.object({
  supplierId: z.string().min(1),
  expiryDays: z.number().int().min(1).max(60).default(EXPIRY_DAYS_DEFAULT),
});

/**
 * R3-4:为(采购询价单 × 供应商)生成免登录报价链接。
 * 供应商填 单价/币种/MOQ/SPQ/LT/有效期/备注 → 落 SupplierOffer+PriceBreak
 * (provider=OFFLINE 线下报价池)。**只收原始报价,不做任何自动选择** ——
 * 正式比价与供应商选择仍走采购人工流程(CLAUDE.md 约束 3)。
 */
export async function POST(req: Request, { params }: { params: Promise<{ prfqId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT")) {
    return forbidden("仅采购或管理层可生成报价链接");
  }
  const { prfqId } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const { raw, hash } = generateActionToken();
  const created = await createRfqQuoteRequest(auth.session, {
    procurementRfqId: prfqId,
    supplierId: parsed.data.supplierId,
    tokenHash: hash,
    expiresAt: expiryFromDays(parsed.data.expiryDays),
  });
  if (!created.ok) return badRequest(created.reason);

  const link = buildConfirmUrl(raw, process.env.APP_PUBLIC_URL, process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  return NextResponse.json({
    url: link.url,
    absolute: link.absolute,
    mpnCount: created.mpnCount,
    note: link.absolute ? null : "APP_PUBLIC_URL 未配置 —— 这是相对路径,外发前请补全域名",
  });
}
