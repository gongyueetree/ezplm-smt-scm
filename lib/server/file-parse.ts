/**
 * 上传文件 → 原始表格行(SPEC §6:CSV/XLSX;图片/PDF)。
 *
 * ⚠ 诚实边界:图片/PDF **不做自动识别**(OCR 属二期,见 INTEGRATION_PLAN 3.3)。
 * 本层只归档原始文件并返回 requiresManualTranscription=true,
 * 由 UI 明确提示"已归档,请人工补录",不得伪装成已解析。
 */
import ExcelJS from "exceljs";
import { detectDelimiter, parseCsv } from "@/lib/domain/csv";

export type UploadKind = "csv" | "xlsx" | "image_pdf" | "unsupported";

export function detectUploadKind(fileName: string, contentType?: string): UploadKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt" || contentType === "text/csv") return "csv";
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "xlsx";
  if (["pdf", "png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(ext)) return "image_pdf";
  if (contentType?.startsWith("image/") || contentType === "application/pdf") return "image_pdf";
  return "unsupported";
}

export interface ExtractResult {
  kind: UploadKind;
  rows: string[][];
  /** 图片/PDF:已归档但需要人工补录(OCR 属二期) */
  requiresManualTranscription: boolean;
  note?: string;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result); // 公式取计算结果
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
}

/** 从上传内容提取表格行;失败抛错由调用方转为结构化响应 */
export async function extractRows(
  fileName: string,
  buffer: Buffer,
  contentType?: string,
): Promise<ExtractResult> {
  const kind = detectUploadKind(fileName, contentType);

  if (kind === "csv") {
    const text = buffer.toString("utf8");
    return {
      kind,
      rows: parseCsv(text, detectDelimiter(text)),
      requiresManualTranscription: false,
    };
  }

  if (kind === "xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return { kind, rows: [], requiresManualTranscription: false, note: "工作簿为空" };
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map(cellToString));
    });
    return { kind, rows, requiresManualTranscription: false };
  }

  if (kind === "image_pdf") {
    return {
      kind,
      rows: [],
      requiresManualTranscription: true,
      note: "图片/PDF 已归档保存;自动识别(OCR)属二期范围,当前需人工补录为 CSV/XLSX 后再导入。",
    };
  }

  return {
    kind,
    rows: [],
    requiresManualTranscription: false,
    note: `不支持的文件类型:${fileName}`,
  };
}
