import { describe, expect, it } from "vitest";
import {
  canQueryFrom,
  scopeDescription,
  scopeEdges,
  SUPPLIER_VISIBLE_KINDS,
  type TraceScope,
} from "@/lib/domain/trace-scope";
import type { TraceEdgeInput } from "@/lib/domain/trace-graph";

const EDGES: TraceEdgeInput[] = [
  { fromRef: "SUPPLIER:富晶", toRef: "PO:PO-1", kind: "PO_TO_RECEIPT" },
  { fromRef: "PO:PO-1", toRef: "RECEIPT:L1", kind: "PO_TO_RECEIPT" },
  { fromRef: "RECEIPT:L1", toRef: "LOT:L1", kind: "RECEIPT_TO_LOT" },
  { fromRef: "LOT:L1", toRef: "WO:WO-1", kind: "LOT_TO_ISSUE" },
  { fromRef: "WO:WO-1", toRef: "FG:FG-1", kind: "WORK_ORDER_TO_FG_LOT" },
  { fromRef: "FG:FG-1", toRef: "SHIPMENT:SH-1", kind: "FG_LOT_TO_SHIPMENT" },
  { fromRef: "SHIPMENT:SH-1", toRef: "CUSTOMER:联创科技", kind: "SHIPMENT_TO_CUSTOMER" },
];

const supplier: TraceScope = { role: "SUPPLIER", supplierKey: "富晶", ownLotNos: ["L1"] };
const internal: TraceScope = { role: "INTERNAL" };

describe("内部角色不受限", () => {
  it("可查任意起点,图不裁剪", () => {
    expect(canQueryFrom("CUSTOMER:联创科技", internal).allowed).toBe(true);
    const g = scopeEdges(EDGES, internal);
    expect(g.edges).toHaveLength(EDGES.length);
    expect(g.truncated).toBe(false);
  });
});

describe("供应商:横向隔离(看不到别家批次)", () => {
  it("能查自己的批次", () => {
    expect(canQueryFrom("LOT:L1", supplier).allowed).toBe(true);
  });

  it("**查别家批次被拒**", () => {
    expect(canQueryFrom("LOT:L999", supplier).allowed).toBe(false);
  });

  it("**拒绝措辞与「不存在」一致,不能拿来枚举别家批次号**", () => {
    const other = canQueryFrom("LOT:L999", supplier);
    expect(other.reason).toBe("未找到与你相关的批次");
    // 别家供应商节点同理
    expect(canQueryFrom("SUPPLIER:别家", supplier).reason).toBe("未找到与你相关的批次");
  });
});

describe("供应商:纵向隔离(看不到下游)", () => {
  it("**不能以工单/成品/出货/客户为起点查询**", () => {
    for (const ref of ["WO:WO-1", "FG:FG-1", "SHIPMENT:SH-1", "CUSTOMER:联创科技"]) {
      const d = canQueryFrom(ref, supplier);
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain("与自身相关");
    }
  });

  it("图裁剪后**只剩上游侧**,下游一条都不留", () => {
    const g = scopeEdges(EDGES, supplier);
    const refs = new Set(g.edges.flatMap((e) => [e.fromRef, e.toRef]));
    expect(refs.has("LOT:L1")).toBe(true);
    expect(refs.has("PO:PO-1")).toBe(true);
    expect([...refs].some((r) => r.startsWith("WO:"))).toBe(false);
    expect([...refs].some((r) => r.startsWith("CUSTOMER:"))).toBe(false);
  });

  it("**裁掉多少条必须报出来** —— 受限视图不能被误读成「下游没影响」", () => {
    const g = scopeEdges(EDGES, supplier);
    expect(g.truncated).toBe(true);
    expect(g.truncatedEdges).toBeGreaterThan(0);
    expect(g.notice).toContain("受限视图");
    expect(g.notice).toContain("隐藏不等于没有影响");
  });

  it("别家批次的边也被裁掉", () => {
    const withOther: TraceEdgeInput[] = [
      ...EDGES,
      { fromRef: "RECEIPT:L9", toRef: "LOT:L9", kind: "RECEIPT_TO_LOT" },
    ];
    const g = scopeEdges(withOther, supplier);
    expect(g.edges.some((e) => e.toRef === "LOT:L9")).toBe(false);
  });
});

describe("可见类型集合与说明", () => {
  it("供应商可见类型只到物料批次", () => {
    expect([...SUPPLIER_VISIBLE_KINDS]).toEqual(["SUPPLIER", "PO", "RECEIPT", "LOT"]);
  });

  it("两种角色的视图说明都写明边界", () => {
    expect(scopeDescription(supplier)).toContain("不对供应商开放");
    expect(scopeDescription(internal)).toContain("完整链路");
  });
});
