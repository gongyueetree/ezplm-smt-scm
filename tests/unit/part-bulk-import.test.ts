import { describe, expect, it } from "vitest";
import { IMPORT_TEMPLATE_HEADERS, parsePartImport, planImport } from "@/lib/domain/part-bulk-import";

describe("批量导入解析", () => {
  it("完整一行", () => {
    const r = parsePartImport(
      "内部料号,MPN,制造商,中文描述,物料分类,封装,MOQ\nEE-IC-1,STM32F103C8T6,ST,MCU,IC,LQFP-48,100",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      internalPn: "EE-IC-1",
      mpn: "STM32F103C8T6",
      categoryL1: "IC",
      moq: 100,
    });
  });

  it("**必需列只有内部料号与 MPN**;缺了整表拒绝", () => {
    const r = parsePartImport("制造商,描述\nST,MCU");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toContain("内部料号");
  });

  it("缺分类/制造商列 → 提示留空且不做推断", () => {
    const r = parsePartImport("内部料号,MPN\nEE-1,M1");
    expect(r.errors).toEqual([]);
    expect(r.notices.join(" ")).toContain("不做推断");
    expect(r.notices.join(" ")).toContain("分类驱动的参数模板将不生效");
    expect(r.rows[0].manufacturer).toBeNull();
  });

  it("逐行报错带行号,坏行不拖垮好行", () => {
    const r = parsePartImport("内部料号,MPN\nEE-1,M1\n,M2\nEE-3,\nEE-4,M4");
    expect(r.rows.map((x) => x.internalPn)).toEqual(["EE-1", "EE-4"]);
    const msgs = r.errors.map((e) => `${e.row}:${e.message}`).join(" | ");
    expect(msgs).toContain("3:缺少内部料号");
    expect(msgs).toContain("4:缺少 MPN");
  });

  it("**同一文件内内部料号重复,在解析阶段就拦下并指出首次出现行**", () => {
    const r = parsePartImport("内部料号,MPN\nEE-1,M1\nEE-1,M2");
    expect(r.rows).toHaveLength(1);
    expect(r.errors[0].message).toContain("第 2 行已出现");
  });

  it("内部料号归一(大写、去空格)后再比重复", () => {
    const r = parsePartImport("内部料号,MPN\n ee-1 ,M1\nEE-1,M2");
    expect(r.errors[0].message).toContain("EE-1");
  });

  it("Tab 分隔与列顺序随意", () => {
    const r = parsePartImport("MPN\t内部料号\nM1\tEE-9");
    expect(r.rows[0]).toMatchObject({ internalPn: "EE-9", mpn: "M1" });
  });

  it("模板表头齐全", () => {
    expect(IMPORT_TEMPLATE_HEADERS).toContain("内部料号");
    expect(IMPORT_TEMPLATE_HEADERS).toContain("MPN");
  });
});

describe("导入计划:与库内现状比对", () => {
  const rows = parsePartImport(
    "内部料号,MPN\nEE-NEW,M-NEW\nEE-DUP,M-X\nEE-OTHER,M-EXIST",
  ).rows;

  it("内部料号已存在 → **阻断该行**", () => {
    const p = planImport(rows, { internalPns: new Set(["EE-DUP"]), mpns: new Set() });
    const blocked = p.rows.find((x) => x.internalPn === "EE-DUP")!;
    expect(blocked.outcome).toBe("BLOCKED_DUPLICATE");
    expect(blocked.reason).toContain("必须唯一");
    expect(p.blocked).toBe(1);
  });

  it("MPN 已存在但料号不同 → **疑似重复,不阻断**,标出来让人决定", () => {
    const p = planImport(rows, { internalPns: new Set(), mpns: new Set(["M-EXIST"]) });
    const sus = p.rows.find((x) => x.internalPn === "EE-OTHER")!;
    expect(sus.outcome).toBe("SUSPECTED_DUPLICATE");
    expect(sus.reason).toContain("可能重复");
    expect(p.suspected).toBe(1);
  });

  it("全新行正常计入待创建", () => {
    const p = planImport(rows, { internalPns: new Set(), mpns: new Set() });
    expect(p.willCreate).toBe(3);
    expect(p.blocked + p.suspected).toBe(0);
  });
});
