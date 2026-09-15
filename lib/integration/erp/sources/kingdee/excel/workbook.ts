/**
 * R4-1:金蝶导出 Excel 的通用读取核心(与 UAT 分析器共用同一实现)。
 *
 * - 表头行探测:前 5 行取非空单元格最多者(金蝶导出偶有标题/过滤行前缀);
 * - 重复表头保留:第二个「备注」→「备注#2」,**不覆盖**(§38);
 *   每行同时保留 sourceRow(Excel 物理行号)供证据链;
 * - 单元格统一转文本(富文本/公式结果/日期);数值语义在 normalization 层处理。
 */
import ExcelJS from "exceljs";

export interface ParsedSheet {
  sheetName: string;
  headerRowIndex: number;
  /** 去重后的表头(备注/备注#2) */
  headers: string[];
  duplicateHeaders: string[];
  rows: { sourceRow: number; cells: Record<string, string> }[];
}

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in (v as object)) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in (v as object)) return String((v as { result: unknown }).result ?? "");
    if ("text" in (v as object)) return String((v as { text: unknown }).text ?? "");
  }
  return String(v);
}

export function findHeaderRow(ws: ExcelJS.Worksheet): number {
  let best = 1;
  let bestCount = 0;
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    let count = 0;
    ws.getRow(r).eachCell({ includeEmpty: false }, () => count++);
    if (count > bestCount) {
      bestCount = count;
      best = r;
    }
  }
  return best;
}

export function parseSheet(ws: ExcelJS.Worksheet): ParsedSheet {
  const headerRowIndex = findHeaderRow(ws);
  const headerRow = ws.getRow(headerRowIndex);
  const rawHeaders: string[] = [];
  const colIndexes: number[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    rawHeaders.push(cellText(cell.value).trim());
    colIndexes.push(col);
  });

  const seen = new Map<string, number>();
  const duplicateHeaders: string[] = [];
  const headers = rawHeaders.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    if (n === 2) duplicateHeaders.push(h);
    return n === 1 ? h : `${h}#${n}`;
  });

  const rows: ParsedSheet["rows"] = [];
  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Record<string, string> = {};
    let nonEmpty = 0;
    headers.forEach((h, i) => {
      const v = cellText(row.getCell(colIndexes[i]).value).trim();
      cells[h] = v;
      if (v !== "") nonEmpty++;
    });
    if (nonEmpty === 0) continue;
    rows.push({ sourceRow: r, cells });
  }

  return { sheetName: ws.name, headerRowIndex, headers, duplicateHeaders, rows };
}

/** 读文件的主 sheet(行数最多者;金蝶导出均为单 sheet,多 sheet 时如实取主) */
export async function parseMainSheet(buf: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  let main: ParsedSheet | null = null;
  for (const ws of wb.worksheets) {
    if (ws.rowCount === 0) continue;
    const parsed = parseSheet(ws);
    if (!main || parsed.rows.length > main.rows.length) main = parsed;
  }
  if (!main) throw new Error("工作簿没有任何非空 sheet");
  return main;
}
