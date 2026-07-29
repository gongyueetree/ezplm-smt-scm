import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "@/lib/domain/csv";
import {
  countUniqueMpns,
  detectColumnMapping,
  isMappingUsable,
  missingRequiredFields,
  parseQty,
  toStandardLines,
  missingRecommendedFields,
} from "@/lib/domain/bom-parse";

describe("CSV 解析", () => {
  it("处理引号包裹、字段内逗号与换行、双引号转义", () => {
    const csv = 'a,"b,1","say ""hi"""\n"multi\nline",2,3';
    expect(parseCsv(csv)).toEqual([
      ["a", "b,1", 'say "hi"'],
      ["multi\nline", "2", "3"],
    ]);
  });

  it("兼容 CRLF 与 UTF-8 BOM,丢弃全空行", () => {
    const csv = "﻿h1,h2\r\nv1,v2\r\n\r\n";
    expect(parseCsv(csv)).toEqual([
      ["h1", "h2"],
      ["v1", "v2"],
    ]);
  });

  it("空输入返回空数组", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("分隔符探测:逗号/分号/制表符", () => {
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    // 引号内的分隔符不参与计数
    expect(detectDelimiter('"a;b;c;d",x')).toBe(",");
  });
});

describe("列映射(中英文表头)", () => {
  it("识别中文表头", () => {
    const rows = [
      ["位号", "数量", "制造商", "型号", "封装", "描述"],
      ["R1", "1", "Yageo", "RC0603FR-0710KL", "0603", "RES 10K"],
    ];
    const m = detectColumnMapping(rows);
    expect(m.headerRowIndex).toBe(0);
    expect(m.fields).toMatchObject({
      refDes: 0,
      qty: 1,
      manufacturer: 2,
      mpn: 3,
      footprint: 4,
      description: 5,
    });
    expect(isMappingUsable(m)).toBe(true);
  });

  it("识别英文表头", () => {
    const rows = [
      ["Designator", "Qty", "Manufacturer", "MPN", "Package", "Description"],
      ["C1", "2", "Murata", "GRM188R71H104KA93D", "0603", "CAP 0.1uF"],
    ];
    const m = detectColumnMapping(rows);
    expect(m.fields).toMatchObject({ refDes: 0, qty: 1, manufacturer: 2, mpn: 3 });
    expect(isMappingUsable(m)).toBe(true);
  });

  it("非标准 BOM:跳过前置标题行,定位真正的表头(SPEC §6)", () => {
    const rows = [
      ["某某电子有限公司 BOM 表"],
      ["项目:XX-2026", "版本:V1.2"],
      [""],
      ["位号", "用量", "厂商", "制造商料号"],
      ["R1", "1", "Yageo", "RC0603FR-0710KL"],
    ];
    const m = detectColumnMapping(rows);
    expect(m.headerRowIndex).toBe(3);
    expect(isMappingUsable(m)).toBe(true);
    const lines = toStandardLines(rows, m);
    expect(lines).toHaveLength(1);
    expect(lines[0].mpn).toBe("RC0603FR-0710KL");
    expect(lines[0].sourceRow).toBe(5);
  });

  it("缺关键字段时不可用,并指出缺哪个(不猜)", () => {
    const rows = [
      ["位号", "描述"],
      ["R1", "电阻"],
    ];
    const m = detectColumnMapping(rows);
    expect(isMappingUsable(m)).toBe(false);
    // MPN 已从"必填"降为"建议":工程侧 BOM 常常根本没有这一列,
    // 强制必填会把它们直接拒之门外(见下方「现场 BOM 变体」用例)
    expect(missingRequiredFields(m)).toEqual(["qty"]);
    expect(missingRecommendedFields(m)).toEqual(["mpn"]);
  });

  it("未识别的列被记录下来,而不是静默丢弃", () => {
    const rows = [
      ["位号", "数量", "MPN", "客户备注X"],
      ["R1", "1", "ABC", "随便"],
    ];
    const m = detectColumnMapping(rows);
    expect(m.unmapped.map((u) => u.header)).toContain("客户备注X");
  });

  it("置信度随识别字段增多而升高", () => {
    const few = detectColumnMapping([["数量", "MPN"]]);
    const many = detectColumnMapping([["位号", "数量", "MPN", "制造商", "封装", "描述"]]);
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });
});

describe("数量解析(错误不静默填 1)", () => {
  it.each([
    ["10", 10],
    ["10.5", 10.5],
    ["10 pcs", 10],
    ["１０", 10],
  ])("parseQty(%j) → %s", (raw, expected) => {
    expect(parseQty(raw).qty).toBe(expected);
  });

  it("空/非法/非正数一律 null 并带 issue", () => {
    for (const raw of [null, "abc", "0", "-3"]) {
      const r = parseQty(raw);
      expect(r.qty).toBeNull();
      expect(r.issue).toBeTruthy();
    }
  });
});

describe("转标准结构", () => {
  const rows = [
    ["位号", "数量", "MPN", "制造商", "客户料号"],
    ["R1,R2", "2", "RC0603FR-0710KL", "Yageo", "LC-R-001"],
    ["", "", "", "", ""],
    ["C1", "abc", "GRM188R71H104KA93D", "Murata", ""],
    ["备注:以上为主料"],
  ];

  it("空行与附注行被跳过,行号连续", () => {
    const m = detectColumnMapping(rows);
    const lines = toStandardLines(rows, m);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.lineNo)).toEqual([1, 2]);
  });

  it("数量非法的行保留但带 issue(交人工处理,不臆造数量)", () => {
    const m = detectColumnMapping(rows);
    const lines = toStandardLines(rows, m);
    expect(lines[1].qty).toBeNull();
    expect(lines[1].issues.join()).toContain("数量");
  });

  it("缺全部料号标识的行记 issue", () => {
    const r = [
      ["位号", "数量", "MPN", "描述"],
      ["R9", "1", "", "未知电阻"],
    ];
    const m = detectColumnMapping(r);
    const lines = toStandardLines(r, m);
    expect(lines[0].issues.join()).toContain("无法匹配");
  });
});

describe("唯一 MPN 计数(决定是否分批)", () => {
  it("大小写与分隔符差异视为同一 MPN", () => {
    const lines = [
      { mpn: "RC0603FR-0710KL" },
      { mpn: "rc0603fr0710kl" },
      { mpn: "GRM188R71H104KA93D" },
    ] as never as Parameters<typeof countUniqueMpns>[0];
    expect(countUniqueMpns(lines)).toBe(2);
  });

  it("无 MPN 时回落到内部料号/客户料号", () => {
    const lines = [
      { mpn: null, internalPn: "QC-001", customerPn: null },
      { mpn: null, internalPn: null, customerPn: "LC-9" },
      { mpn: null, internalPn: null, customerPn: null },
    ] as never as Parameters<typeof countUniqueMpns>[0];
    expect(countUniqueMpns(lines)).toBe(2);
  });
});

describe("现场 BOM 变体:列名同义词与无 MPN 的工程 BOM", () => {
  // 来自真实样本(KiCad 导出):只有 Qty / Reference(s) / Value / Footprint
  const KICAD = [
    ["LPC824 based 16Pin controller module BOM", "", "", ""],
    ["Qty", "Reference(s)", "Value", "Footprint"],
    ["3", "C1, C3, C5", "1uF", "Capacitor_SMD:C_0402_1005Metric"],
    ["2", "C2, C4", "0.1uF", "Capacitor_SMD:C_0402_1005Metric"],
  ];

  // 另一份真实样本用 Ref / Qnty(拼写省略,不是错别字)
  const KICAD_ALT = [
    ["SimpleDDS Bom List", "", "", ""],
    ["Ref", "Qnty", "Value", "Footprint"],
    ["C4, C1, C5", "7", "0.1uF", "Capacitor_SMD:C_0603_1608Metric"],
  ];

  it("Reference(s) / Qty / Value / Footprint 全部能映射", () => {
    const m = detectColumnMapping(KICAD);
    expect(m.headerRowIndex).toBe(1);
    expect(m.fields.qty).toBe(0);
    expect(m.fields.refDes).toBe(1);
    expect(m.fields.description).toBe(2); // Value 即该行的实质描述
    expect(m.fields.footprint).toBe(3);
  });

  it("Ref / Qnty 这类省略写法同样能映射", () => {
    const m = detectColumnMapping(KICAD_ALT);
    expect(m.fields.refDes).toBe(0);
    expect(m.fields.qty).toBe(1);
    expect(m.fields.description).toBe(2);
  });

  it("没有 MPN 列时**仍可导入**,并逐行标注无法匹配", () => {
    const m = detectColumnMapping(KICAD);
    // 只强制 qty:把 MPN 也设为必填会让工程侧 BOM 直接被拒之门外
    expect(isMappingUsable(m)).toBe(true);
    expect(missingRecommendedFields(m)).toEqual(["mpn"]);

    const lines = toStandardLines(KICAD, m);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ refDes: "C1, C3, C5", qty: 3, mpn: null, description: "1uF" });
    expect(lines[0].issues.join()).toContain("无法匹配");
  });

  it("只有位号+数量的行不会被当成表格附注丢掉", () => {
    const rows = [
      ["位号", "数量"],
      ["C1", "10"],
    ];
    const m = detectColumnMapping(rows);
    expect(toStandardLines(rows, m)).toHaveLength(1);
  });

  it("PartNumber / Manufacturer 等英文表头能映射到 MPN 与制造商", () => {
    const rows = [
      ["Reference", "Description", "Manufacturer", "PartNumber", "数量"],
      ["L1,L2", "INDUCTOR 4.7uH", "Wurth Elektronik", "831534700", "2"],
    ];
    const m = detectColumnMapping(rows);
    expect(m.fields.mpn).toBe(3);
    expect(m.fields.manufacturer).toBe(2);
    expect(missingRecommendedFields(m)).toEqual([]);
    expect(toStandardLines(rows, m)[0]).toMatchObject({
      mpn: "831534700",
      manufacturer: "Wurth Elektronik",
      qty: 2,
    });
  });
});

describe("附注行与真实 BOM 行的区分(放宽位号规则后的护栏)", () => {
  it("整行只有第一列有字的附注不算 BOM 行", () => {
    const rows = [
      ["位号", "数量", "MPN"],
      ["C1", "10", "GRM188"],
      ["备注:以上为主料"],
      ["以下为客户指定品牌,不可替换"],
    ];
    const lines = toStandardLines(rows, detectColumnMapping(rows));
    expect(lines).toHaveLength(1);
    expect(lines[0].refDes).toBe("C1");
  });

  it("位号 + 任意其它列有值就算 BOM 行(工程侧无 MPN 的情形)", () => {
    const rows = [
      ["位号", "数量", "封装"],
      ["C1", "10", "0603"],
      ["C2", "", "0805"],
      ["仅此说明"],
    ];
    const lines = toStandardLines(rows, detectColumnMapping(rows));
    expect(lines.map((l) => l.refDes)).toEqual(["C1", "C2"]);
  });
});
