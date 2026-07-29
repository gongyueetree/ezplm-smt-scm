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
      // 只有空隙接近阈值上限时才补空格。比例定太低会把被拆碎的型号
      // (STM32 | F103)拼成「STM32 F103」,MPN 当场作废。
      const needsSpace = item.x - (prev.x + prev.width) > maxGap * 0.7;
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
 * 推导列的分隔位置 —— 纵向投影法(projection profile)。
 *
 * 为什么不用"必须完全空白的走廊":
 * 真实排版里总有个别超长单元格越过列缝(TI 的 BOM 里,少数很长的 Description
 * 会伸进 PackageReference 列)。只要**有一行**越界,整条缝就消失,两列被永久粘死。
 *
 * 改为统计每个横坐标被多少行覆盖,取覆盖率极低的区段作为列缝:
 * 个别越界行不再能毁掉一条缝,而真正的列内区域覆盖率很高,不会被误切。
 *
 * 另外只统计**真正的表格行**(以单元格数中位数为门槛):
 * 表格上方的标题/文件名/日期行也可能有两三个单元格,但它们横跨在列缝上 ——
 * 实测一份 TI 的 BOM 就是因为顶部的 `PMP23680_TI-BOM.xlsx` 压在
 * Designator 与 Quantity 的缝上,把这两列连同 Value 并成了一列。
 *
 * @param coverageTolerance 覆盖率低于「行数 × 该比例」即视为列缝(默认 0.12)
 */
export function detectColumnBoundaries(
  lines: PdfTextItem[][],
  minGap: number,
  coverageTolerance = 0.12,
): number[] {
  const counts = lines.map((l) => l.length).filter((n) => n >= 2).sort((a, b) => a - b);
  const median = counts.length > 0 ? counts[Math.floor(counts.length / 2)] : 0;
  const minCells = Math.max(3, median);

  let rows = lines.filter((line) => line.length >= minCells);
  // 门槛过严(例如整份只有两三行)时退回宽松规则,总比一条缝都找不到强
  if (rows.length === 0) rows = lines.filter((line) => line.length >= 2);
  if (rows.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  for (const row of rows) {
    for (const it of row) {
      minX = Math.min(minX, it.x);
      maxX = Math.max(maxX, it.x + Math.max(it.width, 0.1));
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX) return [];

  const BUCKET = 1; // 1pt 精度足够;页宽通常 600–850pt
  const size = Math.ceil((maxX - minX) / BUCKET) + 1;
  const coverage = new Array<number>(size).fill(0);
  for (const row of rows) {
    for (const it of row) {
      const from = Math.max(0, Math.floor((it.x - minX) / BUCKET));
      const to = Math.min(size, Math.ceil((it.x + Math.max(it.width, 0.1) - minX) / BUCKET));
      for (let i = from; i < to; i++) coverage[i]++;
    }
  }

  const threshold = Math.floor(rows.length * coverageTolerance);
  const cuts: number[] = [];
  let runStart = -1;
  for (let i = 0; i < size; i++) {
    const empty = coverage[i] <= threshold;
    if (empty && runStart < 0) runStart = i;
    if (!empty && runStart >= 0) {
      // 跳过左边距(runStart === 0):那不是列缝
      if (runStart > 0 && (i - runStart) * BUCKET >= minGap) {
        cuts.push(minX + ((runStart + i) / 2) * BUCKET);
      }
      runStart = -1;
    }
  }
  // 收尾的空白是右边距,不算列缝,故不处理 runStart >= 0 的情况
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
 * **合并阈值与切列阈值必须分开**,这是实测踩出来的:
 * - 合并(把同一格被拆碎的片段拼回)只该发生在几乎贴着的片段之间,
 *   阈值大了会把相邻两列粘死,后面再也分不开;
 * - 切列的走廊只要比一个空格宽就够 —— 一份 TI 的 BOM 里
 *   Designator 与 Quantity 之间的真实走廊只有 5.5pt(字高 8.3pt),
 *   用「1.2 × 字高」当门槛会直接漏掉这道缝,把三列并成一列。
 *
 * 切多了不要紧:列归属按片段**中心点**判定,长描述不会被切碎,
 * 多出来的空列在列映射里忽略即可。
 *
 * @param columnGapFactor 切列走廊阈值 = 中位字高 × 该系数(默认 0.5)
 * @param mergeGapFactor  片段合并阈值 = 中位字高 × 该系数(默认 0.35,约一个空格)
 */
export function buildPdfTable(
  items: PdfTextItem[],
  columnGapFactor = 0.5,
  mergeGapFactor = 0.35,
): PdfTableResult {
  const usable = items.filter((i) => i.text.trim() !== "");
  if (usable.length === 0) return { rows: [], pages: 0, droppedRepeatedHeaders: 0 };

  const tol = rowTolerance(usable);
  const fontHeight = tol * 2; // rowTolerance = 中位字高的一半
  const mergeGap = fontHeight * mergeGapFactor;
  const columnGap = fontHeight * columnGapFactor;
  const lines = groupIntoLines(usable, tol).map((line) => mergeAdjacentItems(line, mergeGap));
  const cuts = detectColumnBoundaries(lines, columnGap);

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
