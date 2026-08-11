import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/server/api";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const Input = z.object({
  kind: z.enum(["MATERIAL", "NRE", "LABOR", "OTHER"]),
  title: z.string().min(1).max(120),
  assignedRole: z.enum(["PM", "PROCUREMENT", "ENGINEERING", "MANAGEMENT"]),
  assignedToUserId: z.string().nullable().optional(),
  required: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

/**
 * PR2-PM-06:报价分项派工。**由 PM 派**(客户 Q6 答复)。
 *
 * `required` 默认 false —— 「什么算关键项」由派工人勾,系统不替业务发明规则。
 * 硬性要求所有任务完成才能提交,只会逼人建假任务或干脆不用这个功能。
 */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "PM" || r === "MANAGEMENT")) {
    return forbidden("报价分项派工由 PM 发起(客户 Q6:PM 派工)", "quote_task_role");
  }
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const version = await prisma.quoteVersion.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: versionId }),
    select: { id: true, quoteId: true, status: true },
  });
  if (!version) return notFound("报价版本不存在或不属于当前租户");
  if (version.status !== "DRAFT") {
    return NextResponse.json(
      { error: "只有草稿版本可以派工 —— 已提交/已批准的版本参数全冻结,改动请开新 Revision" },
      { status: 422 },
    );
  }

  const task = await prisma.quoteComponentTask.create({
    data: tenantData(auth.session.tenantId, {
      quoteId: version.quoteId,
      quoteVersionId: version.id,
      kind: parsed.data.kind,
      title: parsed.data.title.trim(),
      assignedRole: parsed.data.assignedRole,
      assignedToUserId: parsed.data.assignedToUserId ?? null,
      required: parsed.data.required ?? false,
      note: parsed.data.note?.trim() || null,
      createdById: auth.session.userId,
    }),
  });

  await writeAudit(prisma, {
    tenantId: auth.session.tenantId,
    userId: auth.session.userId,
    action: "QUOTE_TASK_ASSIGN",
    entityType: "QuoteComponentTask",
    entityId: task.id,
    after: { kind: task.kind, title: task.title, assignedRole: task.assignedRole, required: task.required },
  });

  return NextResponse.json(
    {
      task,
      note: task.required
        ? "已派工,并标记为「必须完成」—— 未回报价前不能提交审批"
        : "已派工。未标记为必须完成,不阻塞提交审批",
    },
    { status: 201 },
  );
}
