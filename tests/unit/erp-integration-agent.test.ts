/**
 * R4-1:ERP Integration Agent(Source Adapter → Canonical DTO)。
 * 全部使用合成脱敏数据;锁定 R4 v2 的解析纪律:
 * blank→null / 非法→issue / 双备注保留 / MFG_PN 空合法 / 通配→PATTERN /
 * 料号类型一级分类 / 货主类型不猜 / PO 行序稳定。
 */
import { describe, expect, it } from "vitest";
import {
  normalizeBoolean,
  normalizeDate,
  normalizeDecimal,
  normalizeJunkText,
} from "@/lib/integration/erp/normalization/values";
import {
  classifyMaterialKind,
  identifierKindFor,
  identifierMatchModeOf,
} from "@/lib/integration/erp/normalization/material-kind";
import {
  QIANCHUANG_K3_V1,
  detectRole,
  missingRequiredColumns,
} from "@/lib/integration/erp/profiles/qianchuang-k3-v1";
import {
  adaptExcess,
  adaptInventory,
  adaptMaterial,
  adaptMaterialMfg,
  adaptPurchaseOrder,
} from "@/lib/integration/erp/sources/kingdee/excel/adapters";
import type { ParsedSheet } from "@/lib/integration/erp/sources/kingdee/excel/workbook";
import type { SourceRowIssue } from "@/lib/integration/erp/canonical/types";

function sheet(headers: string[], rows: string[][]): ParsedSheet {
  return {
    sheetName: "Sheet1",
    headerRowIndex: 1,
    headers,
    duplicateHeaders: [],
    rows: rows.map((r, i) => ({
      sourceRow: i + 2,
      cells: Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ""])),
    })),
  };
}

describe("值归一化(blank→null;非法→issue;绝不 blank→0)", () => {
  it("decimal:空→null 无 issue;千分位合法;非空非法→INVALID_DECIMAL", () => {
    const issues: SourceRowIssue[] = [];
    expect(normalizeDecimal("", "q", issues)).toBeNull();
    expect(normalizeDecimal("  ", "q", issues)).toBeNull();
    expect(issues).toHaveLength(0);
    expect(normalizeDecimal("1,234.50", "q", issues)).toBe("1234.50");
    expect(normalizeDecimal("-3", "q", issues)).toBe("-3");
    expect(normalizeDecimal("12A", "q", issues)).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ code: "INVALID_DECIMAL", field: "q" })]);
  });

  it("date:金蝶常见形态;空→null;非法→INVALID_DATE", () => {
    const issues: SourceRowIssue[] = [];
    expect(normalizeDate("2026/9/2", "d", issues)).toBe("2026-09-02");
    expect(normalizeDate("2026-09-02 10:44:00", "d", issues)).toBe("2026-09-02");
    expect(normalizeDate("", "d", issues)).toBeNull();
    expect(issues).toHaveLength(0);
    expect(normalizeDate("昨天", "d", issues)).toBeNull();
    expect(issues[0]?.code).toBe("INVALID_DATE");
  });

  it("boolean:是/否/未禁用;未知写法→null 不猜", () => {
    expect(normalizeBoolean("是")).toBe(true);
    expect(normalizeBoolean("未禁用")).toBe(false);
    expect(normalizeBoolean("大概吧")).toBeNull();
  });

  it("垃圾占位(#N/NA/0/-/无)→null;正常值保留", () => {
    for (const junk of ["#N", "#N/A", "NA", "0", "-", "无"]) {
      expect(normalizeJunkText(junk)).toBeNull();
    }
    expect(normalizeJunkText("GRM155R71C104KA88D")).toBe("GRM155R71C104KA88D");
  });
});

describe("MaterialKind 分类(料号类型一级;名称次级;PCBA 不误判 PCB)", () => {
  it("料号类型直接映射,confidence=1.0", () => {
    expect(classifyMaterialKind({ rawMaterialType: "阻容感" })).toMatchObject({
      materialKind: "ELECTRONIC_COMPONENT",
      source: "ERP_MATERIAL_TYPE",
      confidence: 1.0,
    });
    expect(classifyMaterialKind({ rawMaterialType: "PCB" }).materialKind).toBe("PCB_BARE_BOARD");
    expect(classifyMaterialKind({ rawMaterialType: "PCBA" }).materialKind).toBe("ASSEMBLY");
    expect(classifyMaterialKind({ rawMaterialType: "结构件" }).materialKind).toBe("MECHANICAL");
  });

  it("未知 ERP 类型 → OTHER 且降置信度(不猜映射)", () => {
    const r = classifyMaterialKind({ rawMaterialType: "神秘类型" });
    expect(r).toMatchObject({ materialKind: "OTHER", confidence: 0.5 });
  });

  it("无类型时按名称:PCBA 先于 PCB 判(裸 includes 会误判)", () => {
    expect(classifyMaterialKind({ materialName: "主板 PCBA 成品" }).materialKind).toBe("ASSEMBLY");
    expect(classifyMaterialKind({ materialName: "四层 PCB 板" }).materialKind).toBe("PCB_BARE_BOARD");
  });

  it("identifierKind 由 MaterialKind 推导;通配 MFG_PN → PATTERN", () => {
    expect(identifierKindFor("ELECTRONIC_COMPONENT")).toBe("COMPONENT_MPN");
    expect(identifierKindFor("PCB_BARE_BOARD")).toBe("PCB_PART_NO");
    expect(identifierMatchModeOf("GRM155*")).toBe("PATTERN");
    expect(identifierMatchModeOf("GRM155R71C104KA88D")).toBe("EXACT");
    expect(identifierMatchModeOf("")).toBe("UNKNOWN");
  });
});

describe("Profile(列名只在 Profile 出现;缺必需列→文件级错误)", () => {
  it("角色识别覆盖 7 类文件名", () => {
    expect(detectRole(QIANCHUANG_K3_V1, "物料_20260902.xlsx")).toBe("MATERIAL");
    expect(detectRole(QIANCHUANG_K3_V1, "物料MFG维护单_20260903.xlsx")).toBe("MATERIAL_MFG");
    expect(detectRole(QIANCHUANG_K3_V1, "EXCESS REPORT_x.xlsx")).toBe("EXCESS");
    expect(detectRole(QIANCHUANG_K3_V1, "随便.xlsx")).toBeNull();
  });

  it("MFG 维护单接受「物料代码」,其余文件用「物料编码」(别名表)", () => {
    const s = sheet(["单据编号", "物料代码", "MFG", "MFG_PN"], [["DOC-1", "10-01-0001", "Murata", "GRM155R71C104KA88D"]]);
    const r = adaptMaterialMfg(s, "f.xlsx");
    expect(r.fileIssues).toEqual([]);
    expect(r.records[0].internalPn).toBe("10-01-0001");
  });

  it("缺必需列 → fileIssues,零记录", () => {
    expect(missingRequiredColumns(QIANCHUANG_K3_V1, "PURCHASE_ORDER", ["单据编号", "物料编码"])).toEqual(["MFG_PN"]);
    const r = adaptPurchaseOrder(sheet(["单据编号"], [["PO-1"]]), "f.xlsx");
    expect(r.fileIssues.length).toBeGreaterThan(0);
    expect(r.records).toHaveLength(0);
  });
});

describe("适配器语义", () => {
  it("Material:无 MPN 列合法;料号类型分类;Customer PN 只进 unscoped 字段", () => {
    const s = sheet(
      ["编码", "Customer PN", "名称", "料号类型", "物料属性"],
      [
        ["10-01-0001", "CUST-001", "0402 电容", "阻容感", "外购"],
        ["20-02-0002", "", "四层板", "PCB", "外购"],
      ],
    );
    const r = adaptMaterial(s, "m.xlsx");
    expect(r.records[0]).toMatchObject({
      internalPn: "10-01-0001",
      customerPnUnscoped: "CUST-001",
      materialKind: "ELECTRONIC_COMPONENT",
      materialKindSource: "ERP_MATERIAL_TYPE",
    });
    expect(r.records[1].materialKind).toBe("PCB_BARE_BOARD");
    expect(r.records[1].customerPnUnscoped).toBeNull();
    expect(r.records.every((x) => x.issues.length === 0)).toBe(true);
  });

  it("Inventory:货主类型三态;库存只有 onHand,available/reserved=null(§33)", () => {
    const s = sheet(
      ["物料编码", "库存量(主单位)", "货主类型", "货主名称"],
      [
        ["10-01-0001", "1200", "客户", "某客户A"],
        ["10-01-0001", "300", "业务组织", "某组织"],
        ["10-01-0001", "5", "第三方", "谁"],
      ],
    );
    const r = adaptInventory(s, "i.xlsx");
    expect(r.records[0]).toMatchObject({ ownerType: "CUSTOMER", onHandQty: "1200", availableQty: null, reservedQty: null });
    expect(r.records[1].ownerType).toBe("ORGANIZATION");
    expect(r.records[2].ownerType).toBe("UNKNOWN");
    expect(r.records[2].issues[0]?.code).toBe("UNKNOWN_ENUM");
  });

  it("Excess:最后业务发生时间→lastBusinessAt,earliestInboundAt 恒 null(§34);blank 数值→null", () => {
    const s = sheet(
      ["物料编码", "最后业务发生时间", "呆滞数量（不含OPO）", "标准单价"],
      [["10-01-0001", "2026-08-01", "", "abc"]],
    );
    const r = adaptExcess(s, "e.xlsx");
    expect(r.records[0].lastBusinessAt).toBe("2026-08-01");
    expect(r.records[0].earliestInboundAt).toBeNull();
    expect(r.records[0].excessQtyExclOpo).toBeNull(); // blank → null,不是 0
    expect(r.records[0].issues).toEqual([expect.objectContaining({ code: "INVALID_DECIMAL", field: "standardUnitPrice" })]);
  });

  it("PO:双备注各自保留;MFG_PN 空合法;同单据行序稳定;ERP 单据编号为业务身份", () => {
    const s = sheet(
      ["单据编号", "备注", "备注#2", "MFG_PN", "MFG", "物料编码", "采购数量", "单价", "交货日期"],
      [
        ["PO-2026-001", "急单", "工程确认", "GRM155R71C104KA88D", "Murata", "10-01-0001", "1000", "0.05", "2026-10-01"],
        ["PO-2026-001", "", "", "", "#N", "10-01-0002", "500", "1.20", "2026-10-15"],
        ["PO-2026-002", "", "", "STM32F103C8T6", "ST", "10-01-0003", "100", "12.5", ""],
      ],
    );
    const r = adaptPurchaseOrder(s, "po.xlsx");
    expect(r.meta.totalRows).toBe(3);
    expect(r.records[0]).toMatchObject({
      erpPoNumber: "PO-2026-001",
      sourceLineNo: 1,
      remark1: "急单",
      remark2: "工程确认",
      requestedDeliveryDate: "2026-10-01",
    });
    // 第二行:MFG_PN 空合法(无 issue);垃圾 MFG「#N」→ null
    expect(r.records[1]).toMatchObject({ sourceLineNo: 2, rawManufacturerPartNo: null, rawManufacturer: null });
    expect(r.records[1].issues).toEqual([]);
    expect(r.records[2].sourceLineNo).toBe(1); // 新单据行序重新起
  });

  it("MFG 维护单:PATTERN 识别;junk MFG→null;主数据 kind 优先于名称推断", () => {
    const s = sheet(
      ["单据编号", "物料代码", "物料名称", "MFG", "MFG_PN"],
      [
        ["DOC-1", "10-01-0001", "电容", "YAGEO(国巨)", "CC0402*"],
        ["DOC-1", "20-02-0002", "四层 PCB", "#N", "PCB-XX-01"],
      ],
    );
    const kindMap = new Map([
      ["10-01-0001", { materialKind: "ELECTRONIC_COMPONENT", source: "ERP_MATERIAL_TYPE", confidence: 1.0 } as const],
    ]);
    const r = adaptMaterialMfg(s, "mfg.xlsx", kindMap as never);
    expect(r.records[0]).toMatchObject({
      rawManufacturer: "YAGEO(国巨)", // 原始串保留,canonical 解析属 R4-3
      identifierKind: "COMPONENT_MPN",
      identifierMatchMode: "PATTERN",
    });
    expect(r.records[1]).toMatchObject({
      rawManufacturer: null,
      identifierKind: "PCB_PART_NO", // 名称推断(无主数据 kind)
      identifierMatchMode: "EXACT",
    });
  });
});
