import { describe, expect, it } from "vitest";
import { parsePoBulkText } from "@/lib/domain/po-bulk-input";

const TAB = `MPN\t数量\t单价\tMOQ\tSPQ\t交期\t需求日期
STM32F103C8T6\t1000\t7.10\t100\t100\t30\t2026-09-01
GRM188R71H104KA93D\t5000\t0.042\t4000\t4000\t21\t2026/9/10`;

describe("parsePoBulkText:批量录入", () => {
  it("识别 Tab 分隔与中英混排表头,行号从 1 连续编号", () => {
    const r = parsePoBulkText(TAB);
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({
      lineNo: 1,
      mpn: "STM32F103C8T6",
      qty: "1000",
      unitPrice: "7.10",
      moq: 100,
      spq: 100,
      leadTimeDays: 30,
      requestDate: "2026-09-01",
    });
    // 2026/9/10 也要认,并归一成 ISO
    expect(r.lines[1].requestDate).toBe("2026-09-10");
  });

  it("列顺序随意、逗号分隔同样可用", () => {
    const r = parsePoBulkText("数量,MPN\n300,MAX232CPE");
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({ mpn: "MAX232CPE", qty: "300" });
  });

  it("**必需列只有 MPN 与数量**;缺了要指名并给出可用表头写法", () => {
    const r = parsePoBulkText("型号,单价\nABC,1.00");
    expect(r.lines).toEqual([]);
    expect(r.errors[0].message).toContain("数量");
  });

  it("**缺列留空,不填 0** —— 单价填 0 会被复核误读成免费", () => {
    const r = parsePoBulkText("MPN,数量\nABC,10");
    expect(r.lines[0].unitPrice).toBeNull();
    expect(r.lines[0].leadTimeDays).toBeNull();
    expect(r.notices.join(" ")).toContain("单价");
    expect(r.notices.join(" ")).toContain("不做默认值填充");
  });

  it("坏行**逐行报错并带行号**,不静默丢弃,好行照常保留", () => {
    const r = parsePoBulkText(
      "MPN,数量,单价\nA1,100,1.00\nA2,abc,1.00\n,50,1.00\nA4,0,1.00\nA5,100,不是价\nA6,200,2.00",
    );
    expect(r.lines.map((l) => l.mpn)).toEqual(["A1", "A6"]);
    const msgs = r.errors.map((e) => `${e.row}:${e.message}`).join(" | ");
    expect(msgs).toContain("3:");
    expect(msgs).toContain("不是有效数值");
    expect(msgs).toContain("缺少 MPN");
    expect(msgs).toContain("下单 0 颗");
    expect(msgs).toContain("不是有效数值");
  });

  it("千分位与货币符号可容忍", () => {
    const r = parsePoBulkText("MPN,数量,单价\nA1,\"1,000\",¥7.10");
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({ qty: "1000", unitPrice: "7.10" });
  });

  it("非法币种被丢弃而不是硬塞进去", () => {
    const r = parsePoBulkText("MPN,数量,币种\nA1,10,人民币\nA2,10,USD");
    expect(r.lines[0].currency).toBeNull();
    expect(r.lines[1].currency).toBe("USD");
  });

  it("无法识别的日期报错而不是猜一个", () => {
    const r = parsePoBulkText("MPN,数量,需求日期\nA1,10,下个月");
    expect(r.lines).toEqual([]);
    expect(r.errors[0].message).toContain("无法识别");
  });

  it("空输入与只有表头都给出明确说明", () => {
    expect(parsePoBulkText("").errors[0].message).toContain("没有输入内容");
    expect(parsePoBulkText("MPN,数量").errors[0].message).toContain("没有数据行");
  });
});
