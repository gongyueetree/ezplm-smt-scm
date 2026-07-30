import ExcelJS from "exceljs";
import { forbidden, notFound, requireSession } from "@/lib/server/api";
import { canAccessKind } from "@/lib/server/recon-access";
import { getStatement, markPreviewed } from "@/lib/server/repositories/reconciliation";

export const runtime = "nodejs";

/**
 * 导出对账单(含差异明细与账龄)。
 *
 * 客户 docx 问「是否可以实现直接发到指定邮箱?」——
 * 邮件通道**未接入**,所以这里只产出可供人工发送的附件,并记一次"预览"。
 * 文件内与响应都不得出现"已发送"。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const st = await getStatement(auth.session, id);
  if (!st) return notFound();
  if (!canAccessKind(auth.session.roles, st.kind)) return forbidden("无权导出该类对账单");

  await markPreviewed(auth.session, id);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(st.kind === "AR" ? "应收对账" : "应付对账");
  ws.addRow([
    "行",
    "匹配键",
    "单据号",
    "行号",
    "MPN",
    "对方数量",
    "对方单价",
    "对方金额",
    "我方数量",
    "我方单价",
    "我方金额",
    "判定",
    "差额",
    "到期日",
    "处理结论",
    "说明",
  ]);
  for (const l of st.lines) {
    ws.addRow([
      l.lineNo,
      l.matchKey,
      l.docNo ?? "",
      l.docLineNo ?? "",
      l.mpn ?? "",
      l.theirQty ?? "",
      l.theirUnitPrice ?? "",
      l.theirAmount ?? "",
      l.ourQty ?? "",
      l.ourUnitPrice ?? "",
      l.ourAmount ?? "",
      l.verdict,
      l.diffAmount ?? "",
      l.dueDate?.slice(0, 10) ?? "",
      l.resolution ?? "",
      l.details.join(";"),
    ]);
  }
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 15;
  });

  const aging = wb.addWorksheet("账龄分析");
  aging.addRow(["账龄区间", "行数", `金额(${st.aging.currency})`]);
  for (const b of st.aging.buckets) aging.addRow([b.bucket, b.count, b.amount]);
  aging.addRow([]);
  aging.addRow(["逾期合计", "", st.aging.overdueTotal]);
  aging.addRow(["到期日未知合计", "", st.aging.unknownDueTotal]);
  aging.addRow([
    "说明:到期日未知**不并入 0–30 天**;未到期单列。账龄按对方对账单金额计。",
  ]);
  aging.getRow(1).font = { bold: true };
  aging.columns.forEach((c) => {
    c.width = 22;
  });

  const note = wb.addWorksheet("口径说明");
  note.addRow(["项", "说明"]);
  note.addRow(["我方基准来源", st.baselineSource === "DERIVED" ? "本系统已批准单据派生" : "ERP 导出明细上传"]);
  note.addRow([
    "出货/入库数据",
    "本系统不拥有出货、入库、发票记录(属 ERP 数据主权);基准仅为上述来源",
  ]);
  note.addRow(["金额容差", st.amountTolerance]);
  note.addRow(["异币种", "不做汇率换算,判「币种不一致」并从合计中排除"]);
  note.addRow(["发送状态", "本文件为可供人工发送的附件;邮件通道未接入,系统未发送任何邮件"]);
  note.getRow(1).font = { bold: true };
  note.columns.forEach((c) => {
    c.width = 32;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="recon-${st.kind}-${st.code}.xlsx"`,
    },
  });
}
