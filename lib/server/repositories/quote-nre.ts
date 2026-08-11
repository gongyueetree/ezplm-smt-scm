/**
 * NRE 填报落库(客户 Q6:工程填完**直接回报价**,不需审批)。
 *
 * 关键取舍:**NRE 金额直接写成 `category=NRE` 的报价行**,
 * 不另建一张 NRE 金额表。理由很实际 —— 报价总额只能有一个来源。
 * 一旦有两套金额,迟早出现"报价单总额 12 万、NRE 表里还挂着 8 千"这种事,
 * 而且没人说得清哪个对。
 *
 * `categoryConfirmed` 直接置 true:这些行本来就是**人一项项填的**,
 * 不存在"AI 猜了个分类等人确认"的情形。同时记下填报人与时间,
 * 免得"人工确认"变成一个没有主语的布尔值。
 */
import { checkParameterMutation, type QuoteStatusValue } from "@/lib/domain/quote-status";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "@/lib/server/repositories/rfq";

export interface NreLineInput {
  definitionId: string | null;
  name: string;
  amount: string;
  note: string | null;
}

export type FileNreOutcome =
  | { ok: true; created: number; startLineNo: number }
  | { ok: false; code: string; message: string };

export async function fileNreLines(
  session: SessionRef,
  versionId: string,
  items: readonly NreLineInput[],
  taskId: string | null,
): Promise<FileNreOutcome> {
  const version = await prisma.quoteVersion.findFirst({
    where: tenantWhere(session.tenantId, { id: versionId }),
    select: { id: true, status: true },
  });
  if (!version) return { ok: false, code: "not_found", message: "报价版本不存在或不属于当前租户" };

  // 冻结守卫走既有的那一套 —— NRE 不能成为绕过冻结的后门
  const guard = checkParameterMutation(version.status as QuoteStatusValue, "edit_line");
  if (!guard.ok) return { ok: false, code: "frozen", message: guard.message! };

  const last = await prisma.quoteLine.findFirst({
    where: tenantWhere(session.tenantId, { quoteVersionId: versionId }),
    orderBy: { lineNo: "desc" },
    select: { lineNo: true },
  });
  const startLineNo = (last?.lineNo ?? 0) + 1;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.quoteLine.createMany({
      data: items.map((it, i) =>
        tenantData(session.tenantId, {
          quoteVersionId: versionId,
          lineNo: startLineNo + i,
          category: "NRE" as const,
          // 固定格式报价单的「型号/项目」列:NRE 行没有型号,放项目名称,
          // 这样不必为 NRE 在报价单上单开一列。
          quotedMpn: it.name,
          qty: "1",
          customerPrice: it.amount,
          note: it.note,
          categoryConfirmed: true,
          categoryConfirmedById: session.userId,
          categoryConfirmedAt: now,
        }),
      ),
    });

    if (taskId) {
      await tx.quoteComponentTask.updateMany({
        where: tenantWhere(session.tenantId, { id: taskId }),
        data: { status: "SUBMITTED", submittedAt: now, submittedById: session.userId },
      });
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "QUOTE_NRE_FILE",
      entityType: "QuoteVersion",
      entityId: versionId,
      after: {
        taskId,
        items: items.map((it) => ({ name: it.name, amount: it.amount, note: it.note })),
      },
    });
  });

  return { ok: true, created: items.length, startLineNo };
}
