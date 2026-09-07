import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { isFeatureEnabled } from "@/lib/server/tenant-settings";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  customerId: z.string().min(1),
  required: z.boolean(),
  contractNote: z.string().trim().max(1000).nullable().default(null),
  expectedReplyAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});

/**
 * F2(T2,flag ecn.customerNotice):客户告知记录。
 * 状态只能停在 DRAFT —— SENT 必须由真实发送写入(SMTP 未配置时没有任何路径到 SENT)。
 */
export async function POST(req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!(await isFeatureEnabled(auth.session.tenantId, "ecn.customerNotice"))) {
    return notFound("该功能未启用(租户 Feature Flag ecn.customerNotice)");
  }
  const { ecnId } = await params;
  const ecn = await prisma.ecn.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: ecnId }),
    select: { id: true, code: true },
  });
  if (!ecn) return notFound("ECN 不存在或不属于当前租户");

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法");

  const existing = await prisma.ecnCustomerNotice.findFirst({
    where: tenantWhere(auth.session.tenantId, { ecnId: ecn.id, customerId: parsed.data.customerId }),
  });
  const data = {
    required: parsed.data.required,
    contractNote: parsed.data.contractNote,
    expectedReplyAt: parsed.data.expectedReplyAt ? new Date(parsed.data.expectedReplyAt) : null,
    updatedById: auth.session.userId,
  };
  const saved = existing
    ? await prisma.ecnCustomerNotice.update({ where: { id: existing.id }, data })
    : await prisma.ecnCustomerNotice.create({
        data: tenantData(auth.session.tenantId, {
          ecnId: ecn.id,
          customerId: parsed.data.customerId,
          ...data,
        }),
      });
  await writeAudit(prisma, {
    tenantId: auth.session.tenantId,
    userId: auth.session.userId,
    action: "ECN_CUSTOMER_NOTICE_UPSERT",
    entityType: "EcnCustomerNotice",
    entityId: saved.id,
    after: { ecn: ecn.code, customerId: parsed.data.customerId, required: parsed.data.required },
  });
  return NextResponse.json({ ok: true, noticeId: saved.id, status: saved.status });
}
