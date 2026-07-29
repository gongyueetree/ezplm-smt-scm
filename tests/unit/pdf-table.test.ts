import { describe, expect, it } from "vitest";
import {
  buildPdfTable,
  detectColumnBoundaries,
  groupIntoLines,
  mergeAdjacentItems,
  type PdfTextItem,
} from "@/lib/domain/pdf-table";

/** 造一份 3 列表格的文本片段(PDF 坐标:y 越大越靠上) */
function item(text: string, x: number, y: number, page = 1, height = 10): PdfTextItem {
  return { text, x, y, width: text.length * 5, height, page };
}

const HEADER = [item("位号", 50, 700), item("制造商料号", 150, 700), item("用量", 300, 700)];
const ROW1 = [item("C1", 50, 680), item("GRM188R71H104KA93D", 150, 680), item("100", 300, 680)];
const ROW2 = [item("U1", 50, 660), item("STM32F103C8T6", 150, 660), item("2", 300, 660)];

describe("groupIntoLines:按基线聚行", () => {
  it("同一基线的片段聚成一行,并按 x 排序", () => {
    const lines = groupIntoLines([...ROW1].reverse(), 5);
    expect(lines).toHaveLength(1);
    expect(lines[0].map((i) => i.text)).toEqual(["C1", "GRM188R71H104KA93D", "100"]);
  });

  it("基线微小抖动(小于容差)仍算同一行 —— 上下标/不同字号常见", () => {
    const lines = groupIntoLines([item("A", 50, 680), item("B", 150, 682.5)], 5);
    expect(lines).toHaveLength(1);
  });

  it("超过容差就换行,且从上到下(PDF y 轴向上)", () => {
    const lines = groupIntoLines([...ROW2, ...ROW1], 5);
    expect(lines).toHaveLength(2);
    expect(lines[0][0].text).toBe("C1"); // y=680 在上
    expect(lines[1][0].text).toBe("U1");
  });

  it("跨页不合并:即使 y 相同也属于不同行", () => {
    const lines = groupIntoLines([item("P1", 50, 700, 1), item("P2", 50, 700, 2)], 5);
    expect(lines).toHaveLength(2);
  });
});

describe("mergeAdjacentItems:先把贴着的片段并成一格", () => {
  it("空隙小于阈值就合并,宽度取并集", () => {
    const merged = mergeAdjacentItems([item("STM32", 150, 640), item("F103", 176, 640)], 12);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("STM32F103");
    expect(merged[0].x).toBe(150);
    expect(merged[0].x + merged[0].width).toBe(196);
  });

  it("空隙偏大但仍在阈值内时补一个空格,不把词粘死", () => {
    const merged = mergeAdjacentItems([item("ABC", 50, 640), item("DEF", 80, 640)], 20);
    expect(merged[0].text).toBe("ABC DEF");
  });

  it("空隙超过阈值不合并", () => {
    const merged = mergeAdjacentItems([item("ABC", 50, 640), item("DEF", 300, 640)], 12);
    expect(merged).toHaveLength(2);
  });
});

describe("detectColumnBoundaries:按纵向留白走廊切列", () => {
  it("在列与列之间的空隙中点切分", () => {
    const lines = groupIntoLines([...HEADER, ...ROW1], 5);
    const cuts = detectColumnBoundaries(lines, 20);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeGreaterThan(50);
    expect(cuts[0]).toBeLessThan(150);
    expect(cuts[1]).toBeGreaterThan(150);
    expect(cuts[1]).toBeLessThan(300);
  });

  it("某行缺格也不影响切分位置 —— 缝由全表叠加决定", () => {
    const partial = [item("C2", 50, 640), item("50", 300, 640)];
    const withPartial = detectColumnBoundaries(groupIntoLines([...HEADER, ...ROW1, ...partial], 5), 20);
    const without = detectColumnBoundaries(groupIntoLines([...HEADER, ...ROW1], 5), 20);
    expect(withPartial).toEqual(without);
  });

  it("横跨整行的标题不参与统计,否则会把所有缝糊死", () => {
    const title = [item("联创科技 SMT BOM V1.2", 50, 740, 1, 12)];
    // 标题单独成行(只有 1 个片段),应被忽略
    const lines = groupIntoLines([...title, ...HEADER, ...ROW1], 5);
    expect(detectColumnBoundaries(lines, 20)).toHaveLength(2);
  });

  it("没有多格行时返回空切分(整份是单列文本)", () => {
    expect(detectColumnBoundaries([[item("只有一列", 50, 700)]], 20)).toEqual([]);
  });
});

describe("列对齐方式不影响还原 —— 表头居中、数据左对齐是最常见的坑", () => {
  it("表头居中时仍与本列数据落在同一列", () => {
    // 表头居中(压在本列数据的水平范围内),数据左对齐 —— 最常见的排版
    const centeredHeader = [
      item("位号", 60, 700),
      item("料号", 190, 700),
      item("用量", 302, 700),
    ];
    const dataRow = [item("C1", 50, 680), item("GRM188R71H104KA93D", 150, 680), item("100", 300, 680)];
    const t = buildPdfTable([...centeredHeader, ...dataRow]);
    expect(t.rows[0]).toEqual(["位号", "料号", "用量"]);
    expect(t.rows[1]).toEqual(["C1", "GRM188R71H104KA93D", "100"]);
  });

  it("表头完全偏出本列时会多切一列 —— 这是**刻意**的降级方向", () => {
    // 窄数字列 + 远离数据的表头会在列内部造出缝。多切一列只是让人在
    // 列映射里忽略一个空列;并列则会把两列粘死,后面怎么映射都是错的。
    const t = buildPdfTable([
      item("位号", 60, 700),
      item("用量", 330, 700),
      item("C1", 50, 680),
      item("100", 300, 680),
    ]);
    expect(t.rows[0].length).toBeGreaterThan(2);
    // 关键:任何一格都不会出现两列内容被拼在一起
    expect(t.rows[1].some((c) => c.includes("C1") && c.includes("100"))).toBe(false);
  });
});

describe("normalizeCell:NFKC 归一", () => {
  it("康熙部首/兼容字形被归一成正常汉字(部分 PDF 导出会产生)", () => {
    // U+2F64「⽤」肉眼与 U+7528「用」相同,不归一会导致表头匹配全部失效
    const t = buildPdfTable([item("\u2F64量", 50, 700), item("料号", 300, 700)]);
    expect(t.rows[0][0]).toBe("用量");
  });

  it("全角字母数字被归一为半角(MPN 比对依赖这个)", () => {
    const t = buildPdfTable([item("ＳＴＭ３２", 50, 700), item("料号", 300, 700)]);
    expect(t.rows[0][0]).toBe("STM32");
  });
});

describe("buildPdfTable:重建表格", () => {
  it("还原表头与数据行", () => {
    const t = buildPdfTable([...HEADER, ...ROW1, ...ROW2]);
    expect(t.rows).toEqual([
      ["位号", "制造商料号", "用量"],
      ["C1", "GRM188R71H104KA93D", "100"],
      ["U1", "STM32F103C8T6", "2"],
    ]);
    expect(t.pages).toBe(1);
  });

  it("缺格的行保留空字符串占位,不左移错列", () => {
    const partial = [item("C2", 50, 640), item("50", 300, 640)];
    const t = buildPdfTable([...HEADER, ...ROW1, ...partial]);
    expect(t.rows[2]).toEqual(["C2", "", "50"]);
  });

  it("同一单元格被 pdfjs 切成多个片段时拼回(按右边界空隙判断,不按左边界距离)", () => {
    // "STM32" 宽 25(x 150→175),下一个片段从 176 开始 —— 几乎贴着,属同一格
    const split = [item("U2", 50, 640), item("STM32", 150, 640), item("F103", 176, 640)];
    const t = buildPdfTable([...HEADER, ...split]);
    expect(t.rows[1][1]).toBe("STM32F103");
  });

  it("空隙足够大时仍然切成两列 —— 宁可多切一列,也不要把两列并成一列", () => {
    const twoCols = [item("U2", 50, 640), item("STM32", 150, 640), item("100", 300, 640)];
    const t = buildPdfTable([...HEADER, ...twoCols]);
    expect(t.rows[1]).toEqual(["U2", "STM32", "100"]);
  });

  it("翻页重复表头被丢弃并计数", () => {
    const page2Header = HEADER.map((i) => ({ ...i, page: 2 }));
    const page2Row = ROW2.map((i) => ({ ...i, page: 2 }));
    const t = buildPdfTable([...HEADER, ...ROW1, ...page2Header, ...page2Row]);
    expect(t.droppedRepeatedHeaders).toBe(1);
    expect(t.rows).toHaveLength(3);
    expect(t.pages).toBe(2);
  });

  it("空白行被剔除;整份为空时返回空结果而不是崩", () => {
    expect(buildPdfTable([]).rows).toEqual([]);
    expect(buildPdfTable([item("   ", 50, 700)]).rows).toEqual([]);
  });

  it("单元格内多余空白被归一,首尾空格不残留", () => {
    const t = buildPdfTable([item("  位  号 ", 50, 700), item("用量", 300, 700)]);
    expect(t.rows[0]).toEqual(["位 号", "用量"]);
  });
});

describe("列缝识别的两个实测坑(TI BOM)", () => {
  /** 造一张 3 列表格:位号 | 数量 | 型号 */
  function table(rows: [string, string, string][]): PdfTextItem[] {
    const out: PdfTextItem[] = [];
    rows.forEach((r, i) => {
      const y = 700 - i * 12;
      out.push(item(r[0], 18, y), item(r[1], 104, y), item(r[2], 180, y));
    });
    return out;
  }

  it("个别超长单元格越过列缝时,**仍然**能切出这一列", () => {
    const items = table([
      ["位号", "数量", "型号"],
      ["C1", "2", "GRM188"],
      ["C2", "3", "GRM189"],
      ["C3", "4", "GRM190"],
    ]);
    // 再加一行:位号极长,右边界越过了「数量」列的左边界
    const y = 640;
    items.push(
      { text: "C223, C323, C423, C523", x: 18, y, width: 90, height: 10, page: 1 },
      { text: "5", x: 104, y, width: 5, height: 10, page: 1 },
      { text: "GRM191", x: 180, y, width: 30, height: 10, page: 1 },
    );
    const t = buildPdfTable(items);
    // 越界行不该毁掉整条缝 —— 位号与数量必须还是两列
    expect(t.rows[1]).toEqual(["C1", "2", "GRM188"]);
    expect(t.rows[0]).toEqual(["位号", "数量", "型号"]);
  });

  it("表格上方的标题/文件名行不参与列缝统计", () => {
    const items = table([
      ["位号", "数量", "型号"],
      ["C1", "2", "GRM188"],
      ["C2", "3", "GRM189"],
      ["C3", "4", "GRM190"],
    ]);
    // 顶部元信息:一个很宽的文件名,正好压在位号与数量的缝上
    items.push({ text: "PMP23680_TI-BOM.xlsx", x: 18, y: 760, width: 95, height: 10, page: 1 });
    items.push({ text: "REV A", x: 300, y: 760, width: 25, height: 10, page: 1 });
    const t = buildPdfTable(items);
    const header = t.rows.find((r) => r.includes("位号"))!;
    expect(header).toContain("数量");
    // 关键:位号与数量没有被并进同一格
    expect(header.some((c) => c.includes("位号") && c.includes("数量"))).toBe(false);
  });

  it("合并阈值远小于切列阈值 —— 否则相邻两列会被粘死", () => {
    // 两个片段相距 6pt(字高 10):属于不同列,不该被合并
    const t = buildPdfTable([
      item("位号", 18, 700),
      item("数量", 104, 700),
      item("C1", 18, 688),
      item("12", 104, 688),
    ]);
    expect(t.rows[1]).toEqual(["C1", "12"]);
  });
});
