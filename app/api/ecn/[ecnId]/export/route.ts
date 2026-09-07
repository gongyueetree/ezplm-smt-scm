import { notFound, requireSession } from "@/lib/server/api";
import { ECN_STAGE_LABEL, ECN_STATUS_LABEL, ECN_TYPE_LABEL } from "@/lib/domain/ecn";
import { toCsv } from "@/lib/domain/csv";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * F2:导出(Header + Change Lines + Approval History + Affected BOM + Notes)。
 * 已发布的 ECN 以 releasedSnapshot 为准 —— 冻结文档,不从活数据反推。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ ecnId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { ecnId } = await params;
  const ecn = await prisma.ecn.findFirst({
    where: tenantWhere(auth.session.tenantId, { id: ecnId }),
    include: { changeLines: { orderBy: { lineNo: "asc" } }, approvals: { orderBy: { decidedAt: "asc" } } },
  });
  if (!ecn) return notFound();

  const snap = ecn.releasedSnapshot as {
    lines?: { lineNo: number; oldInternalPn: string | null; oldMpn: string | null; newInternalPn: string | null; newMpn: string | null; qtyImpact: string | null; reason: string | null; engineeringNote: string | null; procurementNote: string | null }[];
    approvals?: { stage: string; decision: string; comment: string | null; decidedAt: string }[];
  } | null;
  const lines = snap?.lines ?? ecn.changeLines.map((l) => ({
    lineNo: l.lineNo,
    oldInternalPn: l.oldInternalPn,
    oldMpn: l.oldMpn,
    newInternalPn: l.newInternalPn,
    newMpn: l.newMpn,
    qtyImpact: l.qtyImpact?.toString() ?? null,
    reason: l.reason,
    engineeringNote: l.engineeringNote,
    procurementNote: l.procurementNote,
  }));
  const approvals = snap?.approvals ?? ecn.approvals.map((a) => ({
    stage: a.stage,
    decision: a.decision,
    comment: a.comment,
    decidedAt: a.decidedAt.toISOString(),
  }));

  const bomVersions = await prisma.bOMVersion.findMany({
    where: tenantWhere(auth.session.tenantId, { ecnId: ecn.id }),
    include: { bom: { select: { name: true } } },
  });

  const header = [
    `# ECN 导出 ${snap ? "(来源:发布快照,冻结文档)" : "(未发布,来源:当前数据)"}`,
    `# ${ecn.code} · ${ecn.title} · ${ECN_TYPE_LABEL[ecn.type] ?? ecn.type} · 状态 ${ECN_STATUS_LABEL[ecn.status as never] ?? ecn.status}`,
    `# 原因:${ecn.reason ?? "—"}`,
  ].join("\n");

  const linesCsv = toCsv(
    ["行", "旧内部料号", "旧MPN", "新内部料号", "新MPN", "数量影响", "原因", "工程备注", "采购备注"],
    lines.map((l) => [
      String(l.lineNo),
      l.oldInternalPn ?? "", l.oldMpn ?? "", l.newInternalPn ?? "", l.newMpn ?? "",
      l.qtyImpact ?? "", l.reason ?? "", l.engineeringNote ?? "", l.procurementNote ?? "",
    ]),
  );
  const apprCsv = toCsv(
    ["阶段", "结论", "意见", "时间"],
    approvals.map((a) => [ECN_STAGE_LABEL[a.stage as never] ?? a.stage, a.decision, a.comment ?? "", a.decidedAt]),
  );
  const bomCsv = toCsv(
    ["Apply to BOM 生成的版本", "BOM", "版本号"],
    bomVersions.map((v) => [v.id, v.bom.name, `V${v.versionNo}`]),
  );

  const body = `${header}\n\n## 变更行\n${linesCsv}\n## 审批历史\n${apprCsv}\n## 关联 BOM 版本\n${bomCsv}`;
  return new Response("﻿" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ecn.code}.csv"`,
    },
  });
}
