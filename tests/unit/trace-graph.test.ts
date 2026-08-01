import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  computeBlastRadius,
  detectGaps,
  makeRef,
  parseRef,
  traceBackward,
  traceForward,
  type TraceEdgeInput,
} from "@/lib/domain/trace-graph";

/** 一条完整链路:供应商 → PO → 收料 → 批次 → 工单 → 成品 → 出货 → 客户 */
const FULL: TraceEdgeInput[] = [
  { fromRef: "SUPPLIER:S1", toRef: "PO:PO-1", kind: "PO_TO_RECEIPT", qty: null, occurredAt: "2026-04-01" },
  { fromRef: "PO:PO-1", toRef: "RECEIPT:R1", kind: "PO_TO_RECEIPT", qty: "5000", occurredAt: "2026-04-08" },
  { fromRef: "RECEIPT:R1", toRef: "LOT:L1", kind: "RECEIPT_TO_LOT", qty: "5000", occurredAt: "2026-04-08" },
  { fromRef: "LOT:L1", toRef: "WO:WO-1", kind: "LOT_TO_ISSUE", qty: "200", occurredAt: "2026-04-12" },
  { fromRef: "LOT:L1", toRef: "WO:WO-2", kind: "LOT_TO_ISSUE", qty: "300", occurredAt: "2026-04-13" },
  { fromRef: "WO:WO-1", toRef: "FG:FG-1", kind: "WORK_ORDER_TO_FG_LOT", qty: "200", occurredAt: "2026-04-20" },
  { fromRef: "FG:FG-1", toRef: "SHIPMENT:SH-1", kind: "FG_LOT_TO_SHIPMENT", qty: "150", occurredAt: "2026-04-25" },
];

describe("节点引用", () => {
  it("构造与解析", () => {
    expect(makeRef("LOT", "L1")).toBe("LOT:L1");
    expect(parseRef("LOT:L1")).toEqual({ kind: "LOT", key: "L1" });
  });

  it("批次号里含冒号也能正确解析(只切第一个)", () => {
    expect(parseRef("LOT:2026:07:001")).toEqual({ kind: "LOT", key: "2026:07:001" });
  });

  it("非法引用返回 null", () => {
    expect(parseRef("BOGUS:x")).toBeNull();
    expect(parseRef("noколон")).toBeNull();
  });
});

describe("正向追溯:这批料流到哪去了", () => {
  it("从物料批次一路走到出货", () => {
    const r = traceForward("LOT:L1", FULL);
    expect(r.visited.has("WO:WO-1")).toBe(true);
    expect(r.visited.has("FG:FG-1")).toBe(true);
    expect(r.visited.has("SHIPMENT:SH-1")).toBe(true);
    // 上游不该被带进来
    expect(r.visited.has("PO:PO-1")).toBe(false);
  });

  it("**同批次影响多个工单**", () => {
    const r = traceForward("LOT:L1", FULL);
    expect([...r.visited].filter((x) => x.startsWith("WO:"))).toHaveLength(2);
  });

  it("分层展开:第 1 层是起点本身", () => {
    const r = traceForward("LOT:L1", FULL);
    expect(r.layers[0]).toEqual(["LOT:L1"]);
    expect(r.layers[1].sort()).toEqual(["WO:WO-1", "WO:WO-2"]);
  });
});

describe("反向追溯:这批货是用什么料做的", () => {
  it("从出货单回到供应商", () => {
    const r = traceBackward("SHIPMENT:SH-1", FULL);
    expect(r.visited.has("FG:FG-1")).toBe(true);
    expect(r.visited.has("WO:WO-1")).toBe(true);
    expect(r.visited.has("LOT:L1")).toBe(true);
    expect(r.visited.has("SUPPLIER:S1")).toBe(true);
  });

  it("**同工单使用多个批次**", () => {
    const edges: TraceEdgeInput[] = [
      { fromRef: "LOT:L1", toRef: "WO:WO-1", kind: "LOT_TO_ISSUE", qty: "100" },
      { fromRef: "LOT:L2", toRef: "WO:WO-1", kind: "LOT_TO_ISSUE", qty: "50" },
    ];
    const r = traceBackward("WO:WO-1", edges);
    expect([...r.visited].filter((x) => x.startsWith("LOT:")).sort()).toEqual(["LOT:L1", "LOT:L2"]);
  });
});

describe("环路不会导致死循环", () => {
  it("脏数据造出的环能终止并被记录", () => {
    const cyclic: TraceEdgeInput[] = [
      { fromRef: "LOT:A", toRef: "WO:B", kind: "LOT_TO_ISSUE" },
      { fromRef: "WO:B", toRef: "LOT:A", kind: "LOT_TO_ISSUE" },
    ];
    const r = traceForward("LOT:A", cyclic);
    expect(r.visited.size).toBe(2);
  });
});

describe("**数据缺失 ≠ 无影响**", () => {
  it("批次没有发料记录 → 报「未发现工单用料记录」并给出可能原因", () => {
    const onlyReceipt: TraceEdgeInput[] = [
      { fromRef: "RECEIPT:R1", toRef: "LOT:L1", kind: "RECEIPT_TO_LOT", qty: "5000" },
    ];
    const r = traceForward("LOT:L1", onlyReceipt);
    const gaps = detectGaps(r, onlyReceipt);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain("未发现工单用料记录");
    expect(gaps[0].message).toContain("不代表没有影响");
    expect(gaps[0].possibleCauses.join(" ")).toContain("尚未同步");
  });

  it("工单没有成品记录 → 报缺口而不是判定零影响", () => {
    const partial: TraceEdgeInput[] = [
      { fromRef: "LOT:L1", toRef: "WO:WO-1", kind: "LOT_TO_ISSUE", qty: "200" },
    ];
    const r = traceForward("LOT:L1", partial);
    const gaps = detectGaps(r, partial);
    expect(gaps.some((g) => g.expectedKind === "FG")).toBe(true);
  });

  it("链路完整时没有缺口", () => {
    const r = traceForward("LOT:L1", FULL);
    const gaps = detectGaps(r, FULL);
    // FG-1 已出货、SH-1 到客户这一跳不在样例里,故只可能剩客户段;工单段不该报缺
    expect(gaps.some((g) => g.expectedKind === "WO")).toBe(false);
  });
});

describe("Blast Radius", () => {
  it("统计各层数量,并按出货/在库数据算数量", () => {
    const r = computeBlastRadius({
      sourceRef: "LOT:L1",
      edges: FULL,
      shippedQtyByFgLot: { "FG-1": "150" },
      onHandQtyByLot: { L1: "4320" },
      wipWorkOrders: ["WO-2"],
      customerByShipment: { "SH-1": "联创科技" },
    });
    expect(r.affectedWorkOrders).toBe(2);
    expect(r.affectedFgLots).toBe(1);
    expect(r.affectedShipments).toBe(1);
    expect(r.affectedCustomers).toBe(1);
    expect(r.shippedQty).toBe("150");
    expect(r.onHandQty).toBe("4320");
    expect(r.wipWorkOrders).toBe(1);
  });

  it("**追溯粒度恒为批次级并明确标注 SN 待接入**", () => {
    const r = computeBlastRadius({ sourceRef: "LOT:L1", edges: FULL });
    expect(r.granularity).toBe("LOT");
    expect(r.granularityNote).toContain("批次级");
    expect(r.granularityNote).toContain("SN 级追溯待");
  });

  it("**缺数量的边单独计数**,不当成 0 混进合计", () => {
    const noQty: TraceEdgeInput[] = [
      { fromRef: "LOT:L1", toRef: "WO:WO-1", kind: "LOT_TO_ISSUE", qty: null },
    ];
    const r = computeBlastRadius({ sourceRef: "LOT:L1", edges: noQty });
    expect(r.qtyUnknownEdges).toBe(1);
  });

  it("没有出货数据时 shippedQty 为 0 但缺口会被报出来 —— 二者含义不同", () => {
    const partial: TraceEdgeInput[] = [
      { fromRef: "LOT:L1", toRef: "WO:WO-1", kind: "LOT_TO_ISSUE", qty: "200" },
    ];
    const r = computeBlastRadius({ sourceRef: "LOT:L1", edges: partial });
    expect(r.shippedQty).toBe("0");
    expect(r.gaps.length).toBeGreaterThan(0);
  });
});

describe("时间线", () => {
  it("按时间排序", () => {
    const t = buildTimeline(FULL);
    const dates = t.map((x) => x.occurredAt).filter(Boolean) as string[];
    expect([...dates].sort()).toEqual(dates);
  });

  it("**时间未知的排最后,不当成最早**", () => {
    const edges: TraceEdgeInput[] = [
      { fromRef: "LOT:A", toRef: "WO:B", kind: "LOT_TO_ISSUE", occurredAt: null },
      { fromRef: "LOT:C", toRef: "WO:D", kind: "LOT_TO_ISSUE", occurredAt: "2026-01-01" },
    ];
    const t = buildTimeline(edges);
    expect(t[t.length - 1].occurredAt).toBeNull();
  });
});
