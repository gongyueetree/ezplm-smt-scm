/**
 * HTML 表格 → 二维数组(纯函数,可完全单测)。
 *
 * 为什么需要它:大量"Excel 文件"其实是**改了扩展名的 HTML**——
 * 网页版 ERP/立创/PCB 打样平台的「导出 Excel」多半直接吐 `<table>`,
 * 文件名却叫 `.xlsx`。用 ExcelJS 打开只会报「不是 zip」,
 * 用户看到的是"未能解析出表格内容",完全不知道发生了什么。
 *
 * 纪律:
 * - 只做结构还原,不解释业务语义(哪列是 MPN 由 column-mapping 决定);
 * - colspan / rowspan 按占位展开,**宁可多出空格也不让后续列错位**;
 * - 解析不到任何表格就抛错,不返回空表冒充"这个文件没内容"。
 */

/** 常见 HTML 实体;BOM 导出里出现的就这几种 */
const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  "#160": " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const key = name.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/** 去标签 + 解实体 + 空白归一;<br> 视作空格而不是删掉 */
export function cellTextFromHtml(inner: string): string {
  return decodeEntities(
    inner
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attrNumber(tag: string, name: string): number {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"));
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n : 1;
}

interface PendingSpan {
  colIndex: number;
  remainingRows: number;
  width: number;
}

/** 解析单个 <table> 的内容为二维数组 */
function parseOneTable(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const pending: PendingSpan[] = [];

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];

    // 上一行 rowspan 留下的占位先补进来,否则本行所有列都会左移
    const carried = pending.filter((p) => p.remainingRows > 0);
    for (const span of carried) {
      while (cells.length < span.colIndex) cells.push("");
      for (let i = 0; i < span.width; i++) cells.push("");
      span.remainingRows -= 1;
    }

    const cellRe = /<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[2];
      const text = cellTextFromHtml(cellMatch[3]);
      const colspan = attrNumber(attrs, "colspan");
      const rowspan = attrNumber(attrs, "rowspan");

      const startCol = cells.length;
      cells.push(text);
      for (let i = 1; i < colspan; i++) cells.push("");
      if (rowspan > 1) {
        pending.push({ colIndex: startCol, remainingRows: rowspan - 1, width: colspan });
      }
    }

    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].remainingRows <= 0) pending.splice(i, 1);
    }
    if (cells.some((c) => c !== "")) rows.push(cells);
  }

  return rows;
}

/**
 * 从整份 HTML 里提取表格。
 * 有多个 `<table>` 时取**行数最多**的那个 —— 页眉页脚常见也是表格。
 */
export function parseHtmlTable(html: string): string[][] {
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let best: string[][] = [];
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(html)) !== null) {
    const rows = parseOneTable(match[1]);
    if (rows.length > best.length) best = rows;
  }
  if (best.length === 0) {
    throw new Error("HTML 中没有找到可解析的表格(<table>)");
  }
  // 补齐到统一列宽,避免后续按列取值时越界
  const width = Math.max(...best.map((r) => r.length));
  return best.map((r) => (r.length === width ? r : [...r, ...Array(width - r.length).fill("")]));
}

/** 内容是否像 HTML 表格(与扩展名无关) */
export function looksLikeHtmlTable(text: string): boolean {
  const head = text.slice(0, 8192).toLowerCase();
  return /<table[\s>]/.test(head) || (/<html[\s>]/.test(head) && /<tr[\s>]/.test(head));
}
