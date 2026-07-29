/**
 * 按**内容**判定上传文件的真实格式,而不是信扩展名。
 *
 * 现场取到的真实样本就有三种"名不副实":
 * - 网页导出的 `.xlsx` 其实是 HTML `<table>`(ExcelJS 只会报「不是 zip」);
 * - Apple Numbers 的 `.numbers` 是 zip,但内部是私有格式,和 xlsx 完全不同;
 * - 老 Excel 的 `.xls`(BIFF 复合文档)也不是 zip。
 *
 * 扩展名只作最后的兜底。判错格式的代价是用户看到一句无从下手的
 * 「未能解析出表格内容」—— 必须给出**具体到怎么办**的结论。
 */

export type SniffedFormat =
  | "xlsx" // OOXML 工作簿
  | "numbers" // Apple Numbers(无法解析,须导出)
  | "xls-legacy" // BIFF 复合文档(无法解析,须另存)
  | "zip-unknown" // 是 zip 但不认识
  | "html" // HTML 表格(常被命名为 .xlsx)
  | "pdf"
  | "image"
  | "csv"
  | "unknown";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // 复合文档(老 .xls/.doc)
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

function startsWith(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((b, i) => buf[i] === b);
}

const IMAGE_MAGICS: [string, number[]][] = [
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpeg", [0xff, 0xd8, 0xff]],
  ["gif", [0x47, 0x49, 0x46, 0x38]],
];

/** zip 内部是否含有指定路径片段(只在头部若干 KB 里找中央目录条目名) */
function zipContains(buf: Buffer, needle: string): boolean {
  // 不解压,直接在字节流里找条目名 —— 足够区分 xlsx / numbers,且不引依赖
  return buf.includes(Buffer.from(needle, "latin1"));
}

export function sniffFormat(buffer: Buffer, fileName = ""): SniffedFormat {
  if (buffer.length === 0) return "unknown";

  if (startsWith(buffer, ZIP_MAGIC) || startsWith(buffer, ZIP_EMPTY)) {
    if (zipContains(buffer, "xl/workbook.xml") || zipContains(buffer, "xl/worksheets/")) return "xlsx";
    // Numbers 包的标志性条目
    if (zipContains(buffer, "Index/Document.iwa") || zipContains(buffer, "Metadata/DocumentIdentifier")) {
      return "numbers";
    }
    if (fileName.toLowerCase().endsWith(".numbers")) return "numbers";
    if (fileName.toLowerCase().endsWith(".xlsx") || fileName.toLowerCase().endsWith(".xlsm")) return "xlsx";
    return "zip-unknown";
  }

  if (startsWith(buffer, OLE_MAGIC)) return "xls-legacy";
  if (startsWith(buffer, PDF_MAGIC)) return "pdf";
  for (const [, magic] of IMAGE_MAGICS) {
    if (startsWith(buffer, magic)) return "image";
  }
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image";

  // 文本类:是 HTML 就归 HTML(**不要求头部就出现 <table>** ——
  // 表格可能在几十 KB 之后;而"是网页却没有表格"要由解析层给出具体结论)
  const head = buffer.subarray(0, 8192).toString("utf8").toLowerCase();
  if (/<!doctype\s+html/.test(head) || /<html[\s>]/.test(head) || /<table[\s>]/.test(head)) {
    return "html";
  }
  if (/<\?xml/.test(head) && /<table[\s>]|<worksheet[\s>]/.test(head)) return "html";

  return "csv";
}

/** 无法解析的格式 → 给出**具体怎么办**的说明,而不是一句"解析失败" */
export const UNSUPPORTED_HINT: Partial<Record<SniffedFormat, string>> = {
  numbers:
    "这是 Apple Numbers 文档(.numbers),其内部为私有格式,无法直接解析。" +
    "请在 Numbers 中「文件 → 导出为 → Excel(.xlsx)或 CSV」后再上传。",
  "xls-legacy":
    "这是 Excel 97-2003 的旧格式(.xls 复合文档),本系统不解析该格式。" +
    "请在 Excel/WPS 中「另存为 → Excel 工作簿(.xlsx)」后再上传。",
  "zip-unknown": "文件是压缩包但不是 Excel 工作簿,无法解析;请确认导出格式为 .xlsx 或 .csv。",
};
