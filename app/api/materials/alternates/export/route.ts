import ExcelJS from "exceljs";
import { requireSession } from "@/lib/server/api";
import {
  FUNCTIONAL_VALUES,
  PACKAGE_VALUES,
  PIN_VALUES,
  matchesPreset,
  type AlternateFilterPreset,
  type CompatibilityTriple,
} from "@/lib/domain/alternate-compat";
import { TEMPLATE_HEADER_LABELS } from "@/lib/domain/alternate-bulk";
import { formatDateTime } from "@/lib/format/datetime";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

const CAP = 20_000;
const PRESETS = ["FUNC_SAME_PKG_SAME", "FUNC_SAME_PKG_MINOR", "FUNC_SAME_NOT_PIN", "PIN_TO_PIN_ONLY"] as const;

/**
 * E3:替代关系导出(客户 Q9)。
 *
 * 导出的表**就是导入模板的格式** —— 导出改一改再导回来是最常见的用法,
 * 两边格式不一致等于逼人手工搬列。
 *
 * `?template=1` 只出表头 + 取值说明,用作空白模板。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const templateOnly = url.searchParams.get("template") === "1";
  const rawPreset = url.searchParams.get("preset");
  const preset = (PRESETS as readonly string[]).includes(rawPreset ?? "")
    ? (rawPreset as AlternateFilterPreset)
    : null;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("替代关系");
  ws.addRow(TEMPLATE_HEADER_LABELS);
  ws.columns = TEMPLATE_HEADER_LABELS.map(() => ({ width: 18 }));

  if (!templateOnly) {
    const rows = await prisma.partAlternate.findMany({
      where: tenantWhere(auth.session.tenantId),
      include: {
        part: { select: { internalPn: true, mpn: true, manufacturer: true } },
        alternatePart: { select: { internalPn: true, mpn: true, manufacturer: true } },
      },
      orderBy: { createdAt: "desc" },
      take: CAP + 1,
    });
    const truncated = rows.length > CAP;

    for (const r of rows.slice(0, CAP)) {
      const compat: CompatibilityTriple = {
        functional: r.functionalEquivalence,
        packageCompat: r.packageCompatibility,
        pin: r.pinCompatibility,
      };
      if (preset && !matchesPreset(compat, preset)) continue;
      ws.addRow([
        r.part.internalPn,
        r.part.manufacturer ?? "",
        r.part.mpn ?? "",
        r.alternatePart.internalPn,
        r.alternatePart.manufacturer ?? "",
        r.alternatePart.mpn ?? "",
        r.functionalEquivalence,
        r.packageCompatibility,
        r.pinCompatibility,
        r.reason ?? "",
        r.evidenceSource ?? "",
        r.approvedById ?? "",
        r.note ?? "",
      ]);
    }

    if (truncated) {
      // 截断必须写在文件里 —— 只在页面上提示的话,拿到文件的人看不到
      ws.addRow([]);
      ws.addRow([`⚠ 替代关系超过 ${CAP} 条,本文件只包含最近 ${CAP} 条,不是全部。`]);
    }
  }

  // 取值说明单独一页:导入时写错级别是最常见的错误
  const help = wb.addWorksheet("取值说明");
  help.addRow(["列", "可用取值"]);
  help.addRow(["功能等效", FUNCTIONAL_VALUES.join(" / ")]);
  help.addRow(["封装兼容", PACKAGE_VALUES.join(" / ")]);
  help.addRow([
    "",
    "MINOR_VARIATION 口径(客户 2026-08 确认):高度/尺寸略有不同、thermal pad 不同算;pitch 不同不算(填 DIFFERENT);需要改 PCB 的不在替代范围。所有细微差别均需工程确认。",
  ]);
  help.addRow(["引脚兼容", PIN_VALUES.join(" / ")]);
  help.addRow([]);
  help.addRow(["说明", "三个维度均为必填。不确定请显式填 UNKNOWN —— 留空会被拒绝,系统不替你猜。"]);
  help.addRow(["说明", "基准料与替代料都必须已存在于物料库。导入不会自动建料。"]);
  help.addRow(["导出时间", formatDateTime(new Date())]);
  help.columns = [{ width: 16 }, { width: 70 }];

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${templateOnly ? "alternate-template" : "alternates"}.xlsx"`,
    },
  });
}
