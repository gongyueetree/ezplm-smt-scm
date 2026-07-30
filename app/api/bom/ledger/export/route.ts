import ExcelJS from "exceljs";
import { requireSession } from "@/lib/server/api";
import { DEFAULT_STALE_DAYS, daysSinceUpdate } from "@/lib/domain/bom-ledger";
import { loadBomLedger } from "@/lib/server/repositories/bom-ledger";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * 批量导出(客户 docx:「无批量导出 BOM 清单、批量导出异常物料功能」)。
 * kind=list(默认)导出台账清单;kind=issues 导出异常物料明细。
 * 筛选条件与页面一致 —— 导出的就是你看到的那一份。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "issues" ? "issues" : "list";
  const staleDays = Number.isFinite(Number(url.searchParams.get("staleDays")))
    ? Math.max(1, Number(url.searchParams.get("staleDays")))
    : DEFAULT_STALE_DAYS;
  const today = new Date().toISOString();

  const items = await loadBomLedger(auth.session, {
    customerId: url.searchParams.get("customerId"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  const wb = new ExcelJS.Workbook();

  if (kind === "list") {
    const ws = wb.addWorksheet("BOM 台账");
    ws.addRow([
      "BOM",
      "关联 RFQ",
      "最新版本",
      "行数",
      "EOL 行",
      "待确认行",
      "无候选行",
      "生命周期未知行",
      "最近更新",
      "距今天数",
      "是否超期",
    ]);
    for (const b of items) {
      const age = daysSinceUpdate(b.latestVersionAt, today);
      ws.addRow([
        b.name,
        b.rfqCode ?? "",
        b.latestVersionNo ?? "",
        b.lineCount,
        b.eolLineCount,
        b.unconfirmedLineCount,
        b.noCandidateLineCount,
        b.unknownLifecycleLineCount,
        b.latestVersionAt?.slice(0, 10) ?? "尚无版本",
        age ?? "",
        age !== null && age > staleDays ? `是(口径 ${staleDays} 天)` : "否",
      ]);
    }
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => {
      c.width = 16;
    });
  } else {
    // 异常物料明细:只导出**有问题**的行,并写明问题类型
    const versionIds = items.map((i) => i.latestVersionId).filter(Boolean) as string[];
    const lines = versionIds.length
      ? await prisma.bOMLine.findMany({
          where: tenantWhere(auth.session.tenantId, { bomVersionId: { in: versionIds } }),
          orderBy: [{ bomVersionId: "asc" }, { lineNo: "asc" }],
          include: {
            decisions: { select: { decision: true } },
            bomVersion: { select: { id: true, versionNo: true, bom: { select: { name: true } } } },
          },
        })
      : [];
    const mpns = [...new Set(lines.map((l) => l.mpn).filter(Boolean))] as string[];
    const parts = mpns.length
      ? await prisma.part.findMany({
          where: tenantWhere(auth.session.tenantId, { mpn: { in: mpns } }),
          select: { mpn: true, lifecycle: true },
        })
      : [];
    const lifecycleByMpn = new Map(parts.map((p) => [p.mpn!, p.lifecycle]));

    const ws = wb.addWorksheet("异常物料");
    ws.addRow(["BOM", "版本", "行号", "位号", "MPN", "制造商", "数量", "问题类型", "说明"]);
    for (const l of lines) {
      const issues: string[] = [];
      const lc = l.mpn ? lifecycleByMpn.get(l.mpn) : undefined;
      if (lc === "EOL") issues.push("EOL 停产");
      const d = l.decisions[0];
      if (!d) issues.push("待人工确认");
      else if (d.decision === "NO_MATCH") issues.push("无候选");
      if (issues.length === 0) continue;

      ws.addRow([
        l.bomVersion.bom.name,
        `V${l.bomVersion.versionNo}`,
        l.lineNo,
        l.refDes ?? "",
        l.mpn ?? "",
        l.manufacturer ?? "",
        String(l.qty),
        issues.join(" / "),
        lc === undefined || lc === "UNKNOWN"
          ? "本地库无此料,生命周期未知(未按 EOL 计)"
          : "",
      ]);
    }
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => {
      c.width = 16;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bom-${kind}.xlsx"`,
    },
  });
}
