/**
 * 上传文件 → 原始表格行(SPEC §6:CSV/XLSX;图片/PDF)。
 *
 * 三条**置信度不同**的路径,必须在结果里区分开、由 UI 如实展示:
 * - `spreadsheet`:CSV/XLSX,确定性解析;
 * - `pdf-text`:PDF **有文本层**(Excel/WPS/ERP 导出),几何重建,同样不涉及模型;
 * - `ocr`:图片 / 扫描件 PDF,**模型转写的草稿**,须逐行人工核对。
 *
 * 无论哪条路径,结果都要走同一套列映射 + 校验 + 人工确认链路;
 * 识别不出来时返回 requiresManualTranscription=true 并如实说明原因,
 * 绝不伪装成已解析。
 */
import ExcelJS from "exceljs";
import { detectDelimiter, parseCsv } from "@/lib/domain/csv";
import { parseHtmlTable } from "@/lib/domain/html-table";
import { sniffFormat, UNSUPPORTED_HINT } from "./file-sniff";
import { buildPdfTable } from "@/lib/domain/pdf-table";
import { getBomOcrProvider, OcrError, ocrProviderMode } from "@/lib/providers/ocr";
import { extractPdfTextItems } from "./pdf-extract";

export type UploadKind = "csv" | "xlsx" | "html" | "pdf" | "image" | "unsupported";

/** 数据来源与置信度 —— UI 必须据此区分"解析"与"识别" */
export type ExtractSource = "spreadsheet" | "pdf-text" | "ocr" | "none";

export function detectUploadKind(fileName: string, contentType?: string): UploadKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt" || contentType === "text/csv") return "csv";
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "xlsx";
  if (ext === "pdf" || contentType === "application/pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif"].includes(ext)) return "image";
  if (contentType?.startsWith("image/")) return "image";
  return "unsupported";
}

export interface ExtractResult {
  kind: UploadKind;
  rows: string[][];
  source: ExtractSource;
  /** 已归档但拿不出表格,需要人工补录 */
  requiresManualTranscription: boolean;
  /** 走了模型转写:结果是草稿,UI 必须要求逐行人工核对 */
  isDraft: boolean;
  note?: string;
}

/** 图片按内容类型推出 Anthropic 能吃的 media_type */
function imageMediaType(fileName: string, contentType?: string): string {
  if (contentType?.startsWith("image/")) return contentType === "image/jpg" ? "image/jpeg" : contentType;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
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
  // **按内容判定真实格式**,扩展名只作兜底 ——
  // 现场样本里既有叫 .xlsx 的 HTML,也有叫 .xlsx 的旧 .xls。
  const sniffed = sniffFormat(buffer, fileName);

  const hint = UNSUPPORTED_HINT[sniffed];
  if (hint) {
    return {
      kind: "unsupported",
      rows: [],
      source: "none",
      requiresManualTranscription: true,
      isDraft: false,
      note: `${fileName}:${hint}`,
    };
  }

  if (sniffed === "html") {
    try {
      const rows = parseHtmlTable(buffer.toString("utf8"));
      return {
        kind: "html",
        rows,
        source: "spreadsheet",
        requiresManualTranscription: false,
        isDraft: false,
        note:
          `${fileName} 实际是 HTML 表格(常见于网页版系统的「导出 Excel」),` +
          `已按表格结构解析出 ${rows.length} 行;列映射与每一行仍需人工确认。`,
      };
    } catch {
      return {
        kind: "unsupported",
        rows: [],
        source: "none",
        requiresManualTranscription: true,
        isDraft: false,
        note:
          `${fileName} 的实际内容是一个 HTML 网页,里面没有任何表格 —— ` +
          `这通常是**下载失败后把网页另存成了文件**(例如需要登录、链接失效、或权限不足)。` +
          `请重新下载真实的 BOM 文件后再上传。`,
      };
    }
  }

  // 内容优先于扩展名:纯文本一定不是工作簿,直接按 CSV 走,
  // 免得对一个 .xlsx 名字的文本文件报"不是 zip"这种无从下手的错
  const kind: UploadKind =
    sniffed === "xlsx"
      ? "xlsx"
      : sniffed === "pdf"
        ? "pdf"
        : sniffed === "image"
          ? "image"
          : sniffed === "csv"
            ? "csv"
            : detectUploadKind(fileName, contentType);

  if (kind === "csv") {
    const text = buffer.toString("utf8");
    return {
      kind,
      rows: parseCsv(text, detectDelimiter(text)),
      source: "spreadsheet",
      requiresManualTranscription: false,
      isDraft: false,
    };
  }

  if (kind === "xlsx") {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (e) {
      // 走到这里说明内容嗅探认为是 xlsx 但 ExcelJS 读不了 —— 如实报出原因,
      // 不要笼统说"未能解析出表格内容"
      return {
        kind,
        rows: [],
        source: "none",
        requiresManualTranscription: true,
        isDraft: false,
        note: `${fileName} 无法作为 Excel 工作簿读取:${e instanceof Error ? e.message : String(e)}`,
      };
    }
    /*
     * F5 golden 套件抓出的缺陷:原实现只读 `worksheets[0]`。
     * 客户 BOM 常见"第一张是封面/说明、第二张才是表"的形态 ——
     * 那种文件会被**静默解析成封面**,正是"正常 BOM 导不进"的又一种。
     *
     * 修法:逐张取行,选**非空行最多**的一张(与 E4 批量导入"多文件取行数最多"
     * 同一原则,只是作用在 sheet 维度)。取的不是第一张时在 note 里明说,
     * 让人知道系统读的是哪张表,而不是猜。
     */
    let best: { rows: string[][]; name: string; index: number } | null = null;
    wb.worksheets.forEach((ws, index) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(values.map(cellToString));
      });
      const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== "")).length;
      if (!best || nonEmpty > best.rows.filter((r) => r.some((c) => c.trim() !== "")).length) {
        best = { rows, name: ws.name, index };
      }
    });
    if (!best) {
      return {
        kind,
        rows: [],
        source: "none",
        requiresManualTranscription: false,
        isDraft: false,
        note: "工作簿为空",
      };
    }
    const picked = best as { rows: string[][]; name: string; index: number };
    return {
      kind,
      rows: picked.rows,
      source: "spreadsheet",
      requiresManualTranscription: false,
      isDraft: false,
      note:
        picked.index > 0
          ? `工作簿含 ${wb.worksheets.length} 张工作表,表格取自「${picked.name}」(第 ${picked.index + 1} 张,非空行最多);其余工作表未读取`
          : undefined,
    };
  }

  if (kind === "pdf") {
    // 先试文本层:有文本层就是确定性解析,不该动用模型
    let textLayerError: string | null = null;
    try {
      const extracted = await extractPdfTextItems(buffer);
      if (extracted.hasTextLayer) {
        const table = buildPdfTable(extracted.items);
        if (table.rows.length >= 2) {
          return {
            kind,
            rows: table.rows,
            source: "pdf-text",
            requiresManualTranscription: false,
            isDraft: false,
            note:
              `PDF 含文本层,已按坐标重建表格(${table.pages} 页` +
              (table.droppedRepeatedHeaders > 0
                ? `,去除 ${table.droppedRepeatedHeaders} 行翻页重复表头`
                : "") +
              ");列映射与每一行仍需人工确认。",
          };
        }
      }
    } catch (e) {
      // 文本层解析失败不阻断后续识别,但**必须把真实原因带出去** ——
      // 把"解析器炸了"说成"这是扫描件",会让人白找半天扫描仪。
      textLayerError = e instanceof Error ? e.message : String(e);
    }
    return recognize(
      kind,
      buffer,
      "application/pdf",
      fileName,
      textLayerError
        ? `该 PDF 的文本层解析失败(${textLayerError})`
        : "该 PDF 没有可用文本层(多为扫描件)",
    );
  }

  if (kind === "image") {
    return recognize(kind, buffer, imageMediaType(fileName, contentType), fileName, "图片 BOM");
  }

  return {
    kind,
    rows: [],
    source: "none",
    requiresManualTranscription: false,
    isDraft: false,
    note: `不支持的文件类型:${fileName}`,
  };
}

/** 走模型转写。失败一律如实返回原因,不返回空表冒充"没内容" */
async function recognize(
  kind: UploadKind,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  why: string,
): Promise<ExtractResult> {
  if (ocrProviderMode() === "unavailable") {
    return {
      kind,
      rows: [],
      source: "none",
      requiresManualTranscription: true,
      isDraft: false,
      note: `${why};自动识别需配置 GEMINI_API_KEY 或 ANTHROPIC_API_KEY,当前未配置。文件已归档,请人工补录为 CSV/XLSX 后再导入。`,
    };
  }

  try {
    const result = await getBomOcrProvider().recognizeTable({ buffer, mimeType, fileName });
    return {
      kind,
      rows: result.rows,
      source: "ocr",
      requiresManualTranscription: false,
      isDraft: true,
      note:
        `${why},已由 ${result.vendor}/${result.model} 转写为表格草稿(${result.rows.length} 行)。` +
        `识别结果**不保证准确**,列映射与每一行都必须人工核对后才可采用。` +
        (result.note ? `提示:${result.note}` : ""),
    };
  } catch (e) {
    return {
      kind,
      rows: [],
      source: "none",
      requiresManualTranscription: true,
      isDraft: false,
      note: `${why};自动识别失败:${e instanceof OcrError ? e.message : String(e)}。文件已归档,请人工补录。`,
    };
  }
}
