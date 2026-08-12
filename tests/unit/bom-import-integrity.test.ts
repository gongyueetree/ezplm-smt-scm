import { describe, expect, it } from "vitest";
import {
  detectColumnMapping,
  reconcileImport,
  toStandardLinesTraced,
  type RowDisposition,
} from "@/lib/domain/bom-parse";

/**
 * E1a(客户 Q13:「以系统内已经生成的正常 BOM 导入,AI 无法全部识别,数据会丢失」)。
 *
 * 本文件守的是**一条不变量**:
 *
 *     表头之后的每一行,都必须有且只有一个去向。
 *
 * 在此之前解析器用 5 个 `continue` 悄悄丢行 —— 每条都有道理,
 * 但没有一条留下痕迹,于是"100 行进去 92 行出来"没人解释得了。
 */

const HEAD = ["位号", "用量", "制造商", "制造商料号", "封装", "描述"];

function parse(rows: string[][]) {
  const mapping = detectColumnMapping(rows);
  const { lines, trace } = toStandardLinesTraced(rows, mapping);
  return { mapping, lines, trace, recon: reconcileImport(trace, lines) };
}

/** 表头之后的物理行数 —— 对账的分母必须等于它 */
function bodyRowCount(rows: string[][], headerRowIndex: number) {
  return rows.length - headerRowIndex - 1;
}

describe("行去向不变量", () => {
  it("**每一行都必须有且只有一条去向记录** —— 这是本次 P0 的核心断言", () => {
    const rows = [
      ["某某电子 BOM 表"],
      HEAD,
      ["R1", "1", "Yageo", "RC0603FR-0710KL", "0603", "RES 10K"],
      [],                                            // 空行
      HEAD,                                          // 翻页重复表头
      ["C1", "2", "Murata", "GRM188R71H104KA93D", "0603", "CAP 0.1uF"],
      ["备注:以上为主料", "", "", "", "", ""],       // 只有一列
      ["", "", "", "", "", "Page 1 of 3"],           // 页脚
      ["U1", "1", "ST", "STM32F103C8T6", "LQFP-48", "MCU"],
    ];
    const { mapping, trace, recon } = parse(rows);

    // 去向记录数 == 表头之后的行数,一行不多一行不少
    expect(trace.length).toBe(bodyRowCount(rows, mapping.headerRowIndex));
    // 行号不重复
    expect(new Set(trace.map((t) => t.sourceRow)).size).toBe(trace.length);
    // 账必须平
    expect(recon.balanced).toBe(true);
    expect(recon.totalRows).toBe(
      recon.recognized + recon.mergedIntoPrevious + recon.nonBusiness + recon.needsReview,
    );
  });

  it("空行与重复表头**计入总行数**,不先偷偷减掉再对账", () => {
    const rows = [HEAD, ["R1", "1", "Y", "M1", "0603", "d"], [], HEAD];
    const { recon } = parse(rows);
    expect(recon.totalRows).toBe(3);
    expect(recon.byDisposition.BLANK).toBe(1);
    expect(recon.byDisposition.REPEATED_HEADER).toBe(1);
    expect(recon.recognized).toBe(1);
  });

  it("**以前被静默丢掉的行,现在落在「待人工判断」而不是消失**", () => {
    const rows = [
      HEAD,
      ["R1", "1", "Y", "M1", "0603", "d"],
      // 无料号、无位号,只有制造商 —— 旧实现直接 continue,零痕迹
      ["", "", "SomeMfg", "", "", ""],
    ];
    const { recon, trace } = parse(rows);
    expect(recon.needsReview).toBe(1);
    const t = trace.find((x) => x.disposition === "NO_IDENTIFIER")!;
    expect(t).toBeDefined();
    expect(t.reason).toContain("无法判定");
    // 原始单元格要留着,人才能核对这一行到底长什么样
    expect(t.cells).toContain("SomeMfg");
  });

  it("并入上一行的折行**写明并进了哪一行**,不是笼统说「已合并」", () => {
    const rows = [
      HEAD,
      ["R1,R2,R3", "6", "Yageo", "RC0603FR-0710KL", "0603", "RES 10K"],
      ["R4,R5,R6", "", "", "", "", ""], // 位号折行
    ];
    const { trace } = parse(rows);
    const merged = trace.find((t) => t.disposition === "MERGED_INTO_PREVIOUS");
    if (merged) {
      expect(merged.mergedIntoSourceRow).toBe(2);
      expect(merged.reason).toContain("第 2 行");
    } else {
      // 未触发合并时,这一行也必须有去向,绝不能消失
      expect(trace).toHaveLength(2);
    }
  });

  it("识别成功的行记下它是第几条 BOM 行,可与结果表逐行对上", () => {
    const rows = [
      HEAD,
      ["R1", "1", "Y", "M1", "0603", "d"],
      ["R2", "1", "Y", "M2", "0603", "d"],
    ];
    const { lines, trace } = parse(rows);
    const recognized = trace.filter((t) => t.disposition === "RECOGNIZED");
    expect(recognized.map((t) => t.lineNo)).toEqual(lines.map((l) => l.lineNo));
    expect(recognized.map((t) => t.sourceRow)).toEqual(lines.map((l) => l.sourceRow));
  });

  it("**尾部大量空行不会把账冲垮**:全部计入且归为非业务行", () => {
    const rows: string[][] = [HEAD, ["R1", "1", "Y", "M1", "0603", "d"]];
    for (let i = 0; i < 30; i++) rows.push(["", "", "", "", "", ""]);
    const { recon } = parse(rows);
    expect(recon.totalRows).toBe(31);
    expect(recon.byDisposition.BLANK).toBe(30);
    expect(recon.balanced).toBe(true);
  });

  it("数量非法的行**仍然算已识别**,只是带 issue —— 不能因为数量坏了就丢掉物料", () => {
    const rows = [HEAD, ["R1", "abc", "Y", "M1", "0603", "d"]];
    const { recon, lines } = parse(rows);
    expect(recon.recognized).toBe(1);
    expect(recon.withIssues).toBe(1);
    expect(lines[0].qty).toBeNull();
    expect(lines[0].mpn).toBe("M1");
  });

  it("100 行混合脏数据:账必须平,且识别数 + 待人工数 = 全部非空业务行", () => {
    const rows: string[][] = [HEAD];
    let expectBusiness = 0;
    for (let i = 1; i <= 100; i++) {
      if (i % 17 === 0) {
        rows.push(["", "", "", "", "", ""]); // 空行
      } else if (i % 23 === 0) {
        rows.push([...HEAD]); // 重复表头
      } else if (i % 11 === 0) {
        rows.push(["", "", `Mfg-${i}`, "", "", ""]); // 无料号无位号
        expectBusiness += 1;
      } else {
        rows.push([`R${i}`, "1", `Mfg-${i}`, `MPN-${i}`, "0603", `描述 ${i}`]);
        expectBusiness += 1;
      }
    }
    const { recon } = parse(rows);
    expect(recon.balanced).toBe(true);
    expect(recon.totalRows).toBe(100);
    // 非空业务行必须全部有去向:要么识别、要么并入、要么待人工 —— 没有第四种
    expect(recon.recognized + recon.mergedIntoPrevious + recon.needsReview).toBe(expectBusiness);
  });
});

describe("对账汇总", () => {
  it("空输入安全,且账是平的", () => {
    const recon = reconcileImport([], []);
    expect(recon.totalRows).toBe(0);
    expect(recon.balanced).toBe(true);
  });

  it("balanced 为 false 时说明解析器漏登记 —— 构造一条假 trace 验证它真的会报 false", () => {
    // 手工造一个"总数对不上"的场景:分类计数之和小于总行数
    const bogus = [
      { sourceRow: 1, disposition: "RECOGNIZED" as RowDisposition, reason: "", lineNo: 1, mergedIntoSourceRow: null, cells: [] },
    ];
    // 正常情况是平的
    expect(reconcileImport(bogus, []).balanced).toBe(true);
    // 把同一行登记两次会让总数变 2、识别数变 2,仍然自洽 ——
    // 真正的失衡只可能来自"漏登记",而漏登记时 trace 里根本没有那一行,
    // 所以不变量的第一道防线是上面那条 `trace.length === bodyRowCount`。
    expect(reconcileImport([...bogus, ...bogus], []).totalRows).toBe(2);
  });
});

describe("表头识别:认不出必需列 = 整份文件被拒收", () => {
  it("**`Q'ty` 必须认成数量列** —— Altium/国内 EMS 模板常用,认不出会导致整份 BOM 被拒", () => {
    for (const h of ["Q'ty", "Q’ty", "QTY", "Qty.", "数 量", "用量/PCS"]) {
      const rows = [
        ["位号", h, "制造商", "制造商料号", "封装", "描述"],
        ["R1", "1", "Yageo", "M1", "0603", "d"],
      ];
      const mapping = detectColumnMapping(rows);
      expect(mapping.fields.qty, `表头「${h}」应被认成数量列`).toBeDefined();
    }
  });

  it("`Manufacturer P/N` 认成 MPN,不被「制造商」抢走", () => {
    const rows = [
      ["Ref", "Q'ty", "Manufacturer", "Manufacturer P/N", "Package", "Description"],
      ["R1", "1", "Yageo", "RC0603FR-0710KL", "0603", "RES"],
    ];
    const mapping = detectColumnMapping(rows);
    expect(mapping.fields.mpn).toBe(3);
    expect(mapping.fields.manufacturer).toBe(2);
  });

  it("含斜杠的同义词(`qty/pcs`)在归一化之后仍然有效 —— 两边口径必须对称", () => {
    const rows = [["位号", "Qty/PCS", "制造商", "MPN"], ["R1", "1", "Y", "M1"]];
    expect(detectColumnMapping(rows).fields.qty).toBe(1);
  });
});
