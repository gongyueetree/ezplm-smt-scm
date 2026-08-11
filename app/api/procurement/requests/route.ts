import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import {
  createPurchaseRequest,
  listPurchaseRequests,
  previewGtb,
} from "@/lib/server/repositories/purchase-request";

export const runtime = "nodejs";

const Input = z.object({
  mpn: z.string().min(1),
  demandQty: z.number().positive(),
  scrapRate: z.string().nullable().optional(),
  moq: z.number().int().nonnegative().nullable().optional(),
  spq: z.number().int().nonnegative().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  /* PR2-PROC-05:客户点名的字段 */
  internalPn: z.string().max(100).nullable().optional(),
  manufacturer: z.string().max(100).nullable().optional(),
  requiredDate: z.string().max(40).nullable().optional(),
  customerId: z.string().nullable().optional(),
  projectCode: z.string().max(60).nullable().optional(),
  /** PM 显式确认要占用的 Excess;不传表示不占用(**系统不自动占用**) */
  excessQty: z.number().nonnegative().nullable().optional(),
  /** true = 只试算不落库 */
  previewOnly: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listPurchaseRequests(auth.session) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  /*
   * 试算是**只读**的,任何能看这个页面的角色都可以算 ——
   * 采购接手询价时当然要能复算这个数怎么来的。闸门只拦"落库建单"。
   * (第一版把闸门放在这之前,把采购的试算也一起挡了,是过度收紧。)
   */
  if (parsed.data.previewOnly) {
    return NextResponse.json({ preview: await previewGtb(auth.session.tenantId, parsed.data) });
  }

  /*
   * PR2-PROC-05-A(客户原话:「采购申请单应该是 PM 递交清单或者直接从 ERP 引用」)。
   *
   * 原实现**只校验了登录**,任何角色都能建采购申请 —— 包括供应商账号。
   * 采购申请是下单链路的起点,归属不清就没人对需求量负责。
   * 收口为 PM 建单;MANAGEMENT 保留(它在本系统是全局角色)。
   * 采购看得到、算得了、能接着做询价,但**不能自己给自己发起需求**。
   *
   * 若客户确认「采购也可建」(OPEN-QUESTIONS Q8),在这里加一个角色即可,
   * 是放宽不是重构。
   */
  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT")) {
    return forbidden(
      "采购申请由 PM 发起 —— 采购可在此查看、试算并继续询价,但需求量应由 PM 对客户订单负责",
      "purchase_request_pm_only",
    );
  }
  const pr = await createPurchaseRequest(auth.session, parsed.data);
  return NextResponse.json({ purchaseRequest: pr }, { status: 201 });
}
