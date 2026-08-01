import { describe, expect, it } from "vitest";
import { parseTraceTemplate, TEMPLATE_HEADERS } from "@/lib/domain/trace-import";

describe("收料批次模板", () => {
  it("完整一行", () => {
    const r = parseTraceTemplate(
      "RECEIPT",
      "PO,PO行号,供应商,MPN,内部批次,收料数量,入库时间\nPO-2026-0410,1,深圳富晶,USB-TYPC-15,SR2026-USB-189,5000,2026-04-08",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      poNo: "PO-2026-0410",
      poLineNo: "1",
      internalLot: "SR2026-USB-189",
      receivedQty: "5000",
      receivedAt: "2026-04-08",
    });
  });

  it("缺必需列 → 整表拒绝并指名", () => {
    const r = parseTraceTemplate("RECEIPT", "PO,供应商\nPO-1,S1");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toContain("内部批次");
  });

  it("**缺 PO 列要提示无法回溯到采购订单**", () => {
    const r = parseTraceTemplate("RECEIPT", "内部批次,收料数量\nL1,100");
    expect(r.errors).toEqual([]);
    expect(r.notices.join(" ")).toContain("无法回溯到采购订单");
  });
});

describe("工单用料模板(全链路最关键的一跳)", () => {
  it("工单号与批次号缺任一都逐行报错", () => {
    const r = parseTraceTemplate(
      "WO_ISSUE",
      "工单号,物料批次,发料数量\nWO-1,L1,100\n,L2,50\nWO-3,,20",
    );
    expect(r.rows).toHaveLength(1);
    const msgs = r.errors.map((e) => `${e.row}:${e.message}`).join(" | ");
    expect(msgs).toContain("3:");
    expect(msgs).toContain("工单号");
    expect(msgs).toContain("4:");
    expect(msgs).toContain("物料批次");
  });

  it("**数量为 0 的发料行没有业务含义 → 报错而非静默跳过**", () => {
    const r = parseTraceTemplate("WO_ISSUE", "工单号,物料批次,发料数量\nWO-1,L1,0");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toContain("没有业务含义");
  });

  it("非法数量报错", () => {
    const r = parseTraceTemplate("WO_ISSUE", "工单号,物料批次,发料数量\nWO-1,L1,abc");
    expect(r.errors[0].message).toContain("不是有效数值");
  });

  it("好行与坏行共存时,好行照常保留", () => {
    const r = parseTraceTemplate(
      "WO_ISSUE",
      "工单号,物料批次,发料数量\nWO-1,L1,100\nWO-2,L2,abc\nWO-3,L3,200",
    );
    expect(r.rows.map((x) => x.workOrderNo)).toEqual(["WO-1", "WO-3"]);
    expect(r.errors).toHaveLength(1);
  });
});

describe("出货关系模板", () => {
  it("完整一行", () => {
    const r = parseTraceTemplate(
      "SHIPMENT",
      "成品批次,工单号,客户,客户PO,出货单号,出货数量,出货日期\nFG-1,WO-1,联创科技,CPO-9,SH-1,150,2026/4/25",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ fgLotNo: "FG-1", shipmentNo: "SH-1", shippedQty: "150", shippedAt: "2026-04-25" });
  });

  it("**缺工单列要提示无法回溯到生产工单**", () => {
    const r = parseTraceTemplate("SHIPMENT", "成品批次,出货单号,出货数量\nFG-1,SH-1,10");
    expect(r.notices.join(" ")).toContain("无法回溯到生产工单");
  });

  it("日期识别不出 → 该行时间按未知,并留提示(不猜一个日期)", () => {
    const r = parseTraceTemplate("SHIPMENT", "成品批次,出货单号,出货数量,出货日期\nFG-1,SH-1,10,下周");
    expect(r.rows[0].shippedAt).toBeNull();
    expect(r.notices.join(" ")).toContain("无法识别");
  });
});

describe("通用", () => {
  it("Tab 分隔与列顺序随意都能认", () => {
    const r = parseTraceTemplate("WO_ISSUE", "物料批次\t发料数量\t工单号\nL1\t100\tWO-1");
    expect(r.errors).toEqual([]);
    expect(r.rows[0].workOrderNo).toBe("WO-1");
  });

  it("空输入与只有表头都给明确说明", () => {
    expect(parseTraceTemplate("RECEIPT", "").errors[0].message).toContain("没有输入内容");
    expect(parseTraceTemplate("RECEIPT", "内部批次,收料数量").errors[0].message).toContain("没有数据行");
  });

  it("三张模板的表头示例都齐全", () => {
    expect(TEMPLATE_HEADERS.RECEIPT).toContain("内部批次");
    expect(TEMPLATE_HEADERS.WO_ISSUE).toContain("工单号");
    expect(TEMPLATE_HEADERS.SHIPMENT).toContain("成品批次");
  });
});
