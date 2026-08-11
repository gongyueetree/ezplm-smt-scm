/**
 * PR-B / PR2-PROC-10:缺料单解析与状态机。
 *
 * 核心纪律:**单据说缺多少就是多少** —— 系统不拿(可能过期的)库存缓存
 * 去"纠正"业务已经认定的缺口。
 */
import { describe, expect, it } from "vitest";
import {
  checkCallQty,
  checkShortageTransition,
  parseShortageSheet,
} from "@/lib/domain/shortage-sheet";

const HEAD = ["客户", "内部料号", "制造商", "MPN", "需求数量", "可用库存", "在途", "供应商", "ETA", "缺口数量", "需求日期"];

describe("缺料单解析", () => {
  it("正常行按单据原样落下,**不重算缺口**", () => {
    const r = parseShortageSheet([
      HEAD,
      ["联创", "EE-001", "ST", "STM32F103", "1000", "300", "200", "SUP-A", "2026-09-01", "500", "2026-08-20"],
    ]);
    expect(r.errors).toEqual([]);
    // 1000 - 300 - 200 = 500 恰好相等,但即便不等也必须用单据给的值
    expect(r.lines[0].shortageQty).toBe("500");
    expect(r.lines[0].mpn).toBe("STM32F103");
    expect(r.lines[0].supplier).toBe("SUP-A");
  });

  it("库存与单据对不上时**仍用单据的缺口**,不做纠正", () => {
    const r = parseShortageSheet([
      HEAD,
      ["联创", "EE-001", "ST", "STM32F103", "1000", "999", "0", "", "", "500", ""],
    ]);
    // 按库存算应该只缺 1,但单据说 500 —— 系统不越权改写
    expect(r.lines[0].shortageQty).toBe("500");
  });

  it("缺 MPN 或缺口非数字时带行号报错,不静默丢", () => {
    const r = parseShortageSheet([
      HEAD,
      ["", "", "", "", "10", "", "", "", "", "5", ""],
      ["", "", "", "MPN-B", "10", "", "", "", "", "abc", ""],
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3]);
    expect(r.errors[0].message).toContain("MPN");
    expect(r.errors[1].message).toContain("数字");
  });

  it("缺口 ≤ 0 的行报出来而不是静默跳过", () => {
    const r = parseShortageSheet([HEAD, ["", "", "", "MPN-C", "10", "", "", "", "", "0", ""]]);
    expect(r.errors[0].message).toContain("不是缺料行");
    expect(r.lines).toHaveLength(0);
  });

  it("缺必需列时说清缺哪几列(中文标签)", () => {
    const r = parseShortageSheet([["客户", "内部料号"], ["联创", "EE-001"]]);
    expect(r.errors[0].message).toContain("MPN");
    expect(r.errors[0].message).toContain("缺口数量");
    expect(r.errors[0].message).not.toContain("shortageQty");
  });

  it("没有供应商列时给出提示 —— Call 料要人工指定", () => {
    const r = parseShortageSheet([
      ["MPN", "缺口数量"],
      ["MPN-D", "100"],
    ]);
    expect(r.notices.join(" ")).toContain("供应商");
    expect(r.lines[0].supplier).toBeNull();
  });

  it("含糊日期返回 null 而不是猜", () => {
    const r = parseShortageSheet([
      ["MPN", "缺口数量", "ETA"],
      ["MPN-E", "10", "下个月"],
    ]);
    expect(r.lines[0].eta).toBeNull();
  });

  it("数量缺失回落成 null,**不是 0**", () => {
    const r = parseShortageSheet([
      ["MPN", "缺口数量", "可用库存"],
      ["MPN-F", "10", ""],
    ]);
    expect(r.lines[0].availableInventory).toBeNull();
  });
});

describe("状态机", () => {
  it("正常推进链路成立", () => {
    expect(checkShortageTransition("OPEN", "CALL_CREATED").ok).toBe(true);
    expect(checkShortageTransition("CALL_CREATED", "SENT_TO_SUPPLIER").ok).toBe(true);
    expect(checkShortageTransition("SENT_TO_SUPPLIER", "RESOLVED").ok).toBe(true);
  });

  it("**不允许回退** —— 已发供应商不能退回待处理", () => {
    const r = checkShortageTransition("SENT_TO_SUPPLIER", "OPEN");
    expect(r.ok).toBe(false);
  });

  it("跳过 Call 料直接发供应商被拒", () => {
    expect(checkShortageTransition("OPEN", "SENT_TO_SUPPLIER").ok).toBe(false);
  });

  it("已处理是终态,并提示新开一轮", () => {
    const r = checkShortageTransition("RESOLVED", "CALL_CREATED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("终态");
  });

  it("同状态重复流转被拒", () => {
    expect(checkShortageTransition("OPEN", "OPEN").ok).toBe(false);
  });
});

describe("Call 料数量", () => {
  it("必须大于 0", () => {
    expect(checkCallQty("0", "500").ok).toBe(false);
    expect(checkCallQty("-1", "500").ok).toBe(false);
  });

  it("**不得超过缺口**,超了要说清超在哪", () => {
    const r = checkCallQty("600", "500");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("600");
      expect(r.message).toContain("500");
    }
  });

  it("等于缺口可以", () => {
    expect(checkCallQty("500", "500").ok).toBe(true);
  });

  it("非数字被拒,不抛错", () => {
    expect(checkCallQty("一批", "500").ok).toBe(false);
  });
});
