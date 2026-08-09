/**
 * A-3 回归:追溯图边**静默截断**。
 *
 * 原实现 `take: 20000` 取满就停,且没有任何人知道取满了。
 * 在追溯场景里这不是"少显示几行" —— 影响面算少意味着**漏召回**:
 * 真正吃到问题批次的客户根本不会出现在结论里,而页面照样给出
 * 一份看起来很确定的 KPI。
 *
 * 本文件不做源码关键词自检:直接 mock 掉 prisma,**真的调用** loadEdges /
 * queryTrace,断言 take 值、切片行为、提示文案与置信度降级。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 记录每次 traceEdge.findMany 收到的参数,用来验证「多取一条」确实发生了 */
const findManyCalls: { take?: number }[] = [];
let edgeRows: Record<string, unknown>[] = [];

vi.mock("@/lib/server/db", () => ({
  prisma: {
    traceEdge: {
      findMany: (args: { take?: number }) => {
        findManyCalls.push(args);
        // 真实 Prisma 会按 take 截断,mock 必须照做,否则测的是假行为
        return Promise.resolve(
          typeof args.take === "number" ? edgeRows.slice(0, args.take) : edgeRows,
        );
      },
    },
    traceShipmentLine: { findMany: () => Promise.resolve([]) },
    workOrderMaterialIssue: { findMany: () => Promise.resolve([]) },
    materialLot: { findMany: () => Promise.resolve([]) },
    traceWorkOrder: { findMany: () => Promise.resolve([]) },
    traceShipment: { findMany: () => Promise.resolve([]) },
  },
}));

const { EDGE_QUERY_CAP, loadEdges, queryTrace } = await import(
  "@/lib/server/repositories/traceability"
);

const SESSION = { tenantId: "t1", userId: "u1" } as never;

/** 数据齐全的一条边:有时间戳、有可折算数量 —— 这样覆盖率才可能算高 */
function edge(from: string, to: string, kind: string) {
  return {
    fromRef: from,
    toRef: to,
    kind,
    qty: "100",
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    quantity: "100",
    uom: "PCS",
    baseQuantity: "100",
    baseUom: "PCS",
    conversionFactor: "1",
  };
}

/**
 * 一条**数据完整**的全链路:收料 → 批次 → 发料 → 工单 → 成品 → 出货 → 客户。
 *
 * 必须用完整链路,不能图省事用两条边:两条边的图**本身**就是 LOW,
 * 那样"截断后降为 LOW"的断言即使降级逻辑被删掉也照样通过 —— 假绿。
 */
function fullChain() {
  return [
    edge("RECEIPT:R0", "LOT:L0", "RECEIPT_TO_LOT"),
    edge("LOT:L0", "WO:W0", "LOT_TO_ISSUE"),
    edge("WO:W0", "FG:F0", "WORK_ORDER_TO_FG_LOT"),
    edge("FG:F0", "SHIPMENT:S0", "FG_LOT_TO_SHIPMENT"),
    edge("SHIPMENT:S0", "CUSTOMER:C0", "SHIPMENT_TO_CUSTOMER"),
  ];
}

/** 与被查链路无关的边,只用来把行数撑到上限 */
function fillerEdges(n: number) {
  return Array.from({ length: n }, (_, i) =>
    edge(`RECEIPT:X${i}`, `LOT:X${i}`, "RECEIPT_TO_LOT"),
  );
}

beforeEach(() => {
  findManyCalls.length = 0;
  edgeRows = [];
});

describe("loadEdges 的上限探测", () => {
  it("多取一条:take 必须是 cap + 1,否则永远无法区分「正好取满」与「还有更多」", async () => {
    edgeRows = fillerEdges(10);
    await loadEdges(SESSION);
    expect(findManyCalls[0]?.take).toBe(EDGE_QUERY_CAP + 1);
  });

  it("正好等于上限时不算截断 —— 不能把恰好取满误报成数据不全", async () => {
    edgeRows = fillerEdges(EDGE_QUERY_CAP);
    const r = await loadEdges(SESSION);
    expect(r.capHit).toBe(false);
    expect(r.edges).toHaveLength(EDGE_QUERY_CAP);
  });

  it("超出上限时 capHit=true,且返回值仍裁到 cap(第 N+1 条只用于探测,不进图)", async () => {
    edgeRows = fillerEdges(EDGE_QUERY_CAP + 1);
    const r = await loadEdges(SESSION);
    expect(r.capHit).toBe(true);
    expect(r.edges).toHaveLength(EDGE_QUERY_CAP);
    expect(r.cap).toBe(EDGE_QUERY_CAP);
  });
});

describe("queryTrace 在图被截断时的结论", () => {
  it("未触顶:不产生截断提示,置信度不被强制压低", async () => {
    edgeRows = fullChain();
    const r = await queryTrace(SESSION, "RECEIPT:R0");
    expect(r.edgeCapHit).toBe(false);
    expect(r.truncatedNotice ?? "").not.toMatch(/上限/);
    // 前提校验:这张图在未截断时**不是** LOW,下面的降级用例才有意义
    expect(r.coverage.confidence).not.toBe("LOW");
  });

  it("触顶:必须显式告知截断,且**不得**声称可据此判定无影响", async () => {
    edgeRows = [...fullChain(), ...fillerEdges(EDGE_QUERY_CAP)];
    const r = await queryTrace(SESSION, "RECEIPT:R0");

    expect(r.edgeCapHit).toBe(true);
    expect(r.truncatedNotice).toContain(String(EDGE_QUERY_CAP));
    expect(r.truncatedNotice).toMatch(/不完整|截断/);
    // 这句是本条用例的核心:截断的图不许被当成"没影响"的证据
    expect(r.truncatedNotice).toContain("无影响");
  });

  it("触顶:置信度强制降为 LOW,并在依据里写明原因 —— 残图不得报 HIGH", async () => {
    // 同一张在未截断时非 LOW 的完整链路,仅因为触顶就必须降级
    edgeRows = [...fullChain(), ...fillerEdges(EDGE_QUERY_CAP)];
    const r = await queryTrace(SESSION, "RECEIPT:R0");

    expect(r.coverage.confidence).toBe("LOW");
    expect(r.coverage.reasons.join(" ")).toMatch(/上限/);
    // 结论措辞随置信度一起降级,否则页面仍会写"可直接用于决策"
    expect(r.conclusionCaveat).not.toMatch(/可直接用于/);
  });
});
