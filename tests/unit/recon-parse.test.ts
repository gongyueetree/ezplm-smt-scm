import { describe, expect, it } from "vitest";
import { parseReconText } from "@/lib/domain/recon-parse";

describe("parseReconText:对账单解析", () => {
  it("金额型对账单(只给金额)", () => {
    const r = parseReconText("发票号,行号,MPN,金额,到期日\nINV-001,1,STM32,700.00,2026-08-30");
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({
      docNo: "INV-001",
      docLineNo: 1,
      mpn: "STM32",
      amount: "700.00",
      dueDate: "2026-08-30",
    });
  });

  it("数量单价型对账单(不给金额)", () => {
    const r = parseReconText("单据号\tMPN\t数量\t单价\nDN-9\tABC\t100\t7.00");
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({ qty: "100", unitPrice: "7.00", amount: null });
  });

  it("**金额与数量单价都没有 → 拒绝整表**,说明至少要有一种", () => {
    const r = parseReconText("发票号,MPN\nINV-1,ABC");
    expect(r.lines).toEqual([]);
    expect(r.errors[0].message).toContain("至少要有其中一种");
  });

  it("既无单据号也无 MPN 的表 → 拒绝,因为无法与我方基准配对", () => {
    const r = parseReconText("数量,单价\n100,7.00");
    expect(r.lines).toEqual([]);
    expect(r.errors[0].message).toContain("无法与我方基准配对");
  });

  it("行级:金额与数量单价都缺 → 逐行报错,**不按 0 处理**", () => {
    const r = parseReconText("发票号,MPN,金额,数量,单价\nINV-1,A,700,,\nINV-2,B,,,");
    expect(r.lines).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3 });
    expect(r.errors[0].message).toContain("不按 0 处理");
  });

  it("**缺到期日列时明确提示账龄归入未知**,不并入 0–30", () => {
    const r = parseReconText("发票号,MPN,金额\nINV-1,A,700");
    expect(r.notices.join(" ")).toContain("到期日未知");
    expect(r.notices.join(" ")).toContain("不会并入 0–30");
    expect(r.lines[0].dueDate).toBeNull();
  });

  it("到期日格式怪 → 该行按未知处理并留提示,不猜一个日期", () => {
    const r = parseReconText("发票号,MPN,金额,到期日\nINV-1,A,700,下月底");
    expect(r.lines[0].dueDate).toBeNull();
    expect(r.notices.join(" ")).toContain("无法识别");
  });

  it("千分位与货币符号可容忍;非法币种丢弃并兜底提示", () => {
    const r = parseReconText('发票号,MPN,金额,币种\nINV-1,A,"1,700.50",人民币');
    expect(r.lines[0].amount).toBe("1700.50");
    expect(r.lines[0].currency).toBeNull();
  });

  it("负金额(红字/退货)保留,不当非法值丢掉", () => {
    const r = parseReconText("发票号,MPN,金额\nINV-1,A,-500");
    expect(r.errors).toEqual([]);
    expect(r.lines[0].amount).toBe("-500");
  });

  it("空输入与只有表头都给明确说明", () => {
    expect(parseReconText("").errors[0].message).toContain("没有输入内容");
    expect(parseReconText("发票号,MPN,金额").errors[0].message).toContain("没有数据行");
  });
});
