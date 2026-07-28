/**
 * 带坐标的 PDF 文本片段 → 表格行(纯函数,可完全单测)。
 *
 * 适用范围:**有文本层**的 PDF(Excel/WPS/ERP 导出的 BOM 绝大多数属于此类)。
 * 扫描件没有文本层,不归这里管 —— 那条路走 OCR,且必须被标注为"识别草稿"。
 *
 * 纪律:
 * - 这里只做**几何重建**,不解释任何业务语义(哪列是 MPN 由 column-mapping 决定);
 * - 行/列的聚类阈值由字号推导而非写死,避免不同排版下整张表错行;
 * - 宁可多切一列(人工在列映射里忽略),也不要把两列**并成一列**——
 *   并列会让"制造商料号"和"数量"粘在一起,后面怎么映射都是错的。
 */

export interface PdfTextItem {
  text: string;
  /** 文本片段左下角 x(PDF 用户单位,原点在左下) */
  x: number;
  /** 文本片段基线 y */
  y: number;
  width: number;
  /** 字高;用于推导行合并与列间距阈值 */
  height: number;
  page: number;
}

export interface PdfTableResult {
  rows: string[][];
  /** 参与重建的页数 */
  pages: number;
  /** 被判定为重复表头而丢弃的行数(翻页重复表头) */
  droppedRepeatedHeaders: number;
}

/** 同一行的判定:基线差小于字高的一半 */
function rowTolerance(items: PdfTextItem[]): number {
  const heights = items.map((i) => i.height).filter((h) => h > 0);
  if (heights.length === 0) return 3;
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  return Math.max(1, median * 0.5);
}

/** 把文本片段按基线聚成行(PDF y 轴向上,故从大到小 = 从上到下) */
export function groupIntoLines(items: PdfTextItem[], tolerance: number): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => (a.page - b.page) || b.y - a.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [];
  let anchorY: number | null = null;
  let anchorPage: number | null = null;

  for (const item of sorted) {
    if (
      current.length === 0 ||
      (item.page === anchorPage && Math.abs(item.y - (anchorY as number)) <= tolerance)
    ) {
      if (current.length === 0) {
        anchorY = item.y;
        anchorPage = item.page;
      }
      current.push(item);
      continue;
    }
    lines.push(current.sort((a, b) => a.x - b.x));
    current = [item];
    anchorY = item.y;
    anchorPage = item.page;
  }
  if (current.length > 0) lines.push(current.sort((a, b) => a.x - b.x));
  return lines;
}

/**
 * 合并一行内**贴着的**相邻片段。
 *
 * pdfjs 会把一个单元格拆成多个 item(换字体、换字号、甚至逐词切),
 * 若不先合并,后面按 x 起点定列就会把"STM32 F103"当成两列。
 * 判据用**上一个片段的右边界到下一个片段左边界的空隙**,
 * 而不是两个左边界的距离 —— 后者会随文本长度变化,不是稳定信号。
 */
export function mergeAdjacentItems(line: PdfTextItem[], maxGap: number): PdfTextItem[] {
  const sorted = [...line].sort((a, b) => a.x - b.x);
  const out: PdfTextItem[] = [];
  for (const item of sorted) {
    const prev = out[out.length - 1];
    if (prev && item.x - (prev.x + prev.width) <= maxGap) {
      const right = Math.max(prev.x + prev.width, item.x + item.width);
      const needsSpace = item.x - (prev.x + prev.width) > maxGap * 0.25;
      out[out.length - 1] = {
        ...prev,
        text: needsSpace ? `${prev.text} ${item.text}` : prev.text + item.text,
        width: right - prev.x,
        height: Math.max(prev.height, item.height),
      };
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

/**
 * 推导列的分隔位置 —— 找**纵向留白走廊**,而不是按左边界聚类。
 *
 * 为什么不能用左边界:表头常常居中、数据常常左对齐或右对齐,
 * 同一列里表头和数据的左边界能差出半个格。按左边界聚类会把表头
 * 和它自己的数据分到不同列(实测:表头整体右移一格,列映射全废)。
 *
 * 留白走廊法:把每行每个单元格覆盖的 [x, x+width] 区间叠起来,
 * 全表都没有文字覆盖、且宽度超过阈值的区间就是列与列之间的缝,
 * 取缝的中点作为切分线。对齐方式怎么变都不影响缝的位置。
 *
 * 只统计**含两个及以上单元格**的行:标题、页脚这种横跨整页的单行
 * 会把所有缝糊死。
 */
export function detectColumnBoundaries(lines: PdfTextItem[][], minGap: number): number[] {
  const spans = lines
    .filter((line) => line.length >= 2)
    .flatMap((line) => line.map((i) => [i.x, i.x + Math.max(i.width, 0.1)] as [number, number]))
    .sort((a, b) => a[0] - b[0]);
  if (spans.length === 0) return [];

  const merged: [number, number][] = [spans[0]];
  for (const [start, end] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const cuts: number[] = [];
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i][0] - merged[i - 1][1];
    if (gap >= minGap) cuts.push((merged[i - 1][1] + merged[i][0]) / 2);
  }
  return cuts;
}

/** 片段落到哪一列:按其**中心点**在哪两条切分线之间 */
function columnIndexFor(item: PdfTextItem, cuts: number[]): number {
  const center = item.x + Math.max(item.width, 0) / 2;
  let idx = 0;
  while (idx < cuts.length && center > cuts[idx]) idx++;
  return idx;
}

/**
 * 单元格文本归一。
 * NFKC 很关键:部分 PDF 导出会把汉字编成**康熙部首/兼容字形**
 * (如 U+2F64「⽤」而非 U+7528「用」),肉眼一模一样,
 * 但表头匹配、MPN 比对全部会失败。
 */
function normalizeCell(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function rowKey(row: string[]): string {
  return row.map((c) => c.toUpperCase()).join("");
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => c === "");
}

/**
 * 重建表格。
 *
 * @param columnGapFactor 列间距阈值 = 中位字高 × 该系数。默认 1.2:
 *   小于一个字宽的间隔按同列处理(单元格内的空格),更大的才切列。
 */
export function buildPdfTable(items: PdfTextItem[], columnGapFactor = 1.2): PdfTableResult {
  const usable = items.filter((i) => i.text.trim() !== "");
  if (usable.length === 0) return { rows: [], pages: 0, droppedRepeatedHeaders: 0 };

  const tol = rowTolerance(usable);
  const gap = tol * 2 * columnGapFactor;
  const lines = groupIntoLines(usable, tol).map((line) => mergeAdjacentItems(line, gap));
  const cuts = detectColumnBoundaries(lines, gap);

  const rows: string[][] = [];
  for (const line of lines) {
    const cells: string[] = new Array(cuts.length + 1).fill("");
    for (const item of line) {
      const idx = columnIndexFor(item, cuts);
      cells[idx] = cells[idx] ? `${cells[idx]} ${item.text}` : item.text;
    }
    const row = cells.map(normalizeCell);
    if (!isBlankRow(row)) rows.push(row);
  }

  // 翻页重复表头:与第一行完全相同的后续行一律丢弃
  let droppedRepeatedHeaders = 0;
  if (rows.length > 1) {
    const headerKey = rowKey(rows[0]);
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rowKey(rows[i]) === headerKey) {
        rows.splice(i, 1);
        droppedRepeatedHeaders++;
      }
    }
  }

  const pages = new Set(usable.map((i) => i.page)).size;
  return { rows, pages, droppedRepeatedHeaders };
}
