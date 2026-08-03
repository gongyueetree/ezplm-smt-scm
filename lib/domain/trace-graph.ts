/**
 * 批次级追溯图:正向/反向遍历与影响范围(Blast Radius)计算。
 *
 * 供应链正向顺序:
 *   供应商 → PO → 收料批次 → 物料批次 → 发料 → 工单 → 成品批次 → 出货 → 客户
 *
 * 纪律(这是整个模块最容易做错的地方):
 * - **数据缺失 ≠ 无影响**。某一跳没有数据时,必须产出「数据缺口」而不是把影响算成 0。
 *   把"查不到工单用料记录"显示成"未影响任何工单",会让人在真出事时错判;
 * - **一期只到批次级**。没有 SN 数据就如实说 SN 级待接入,不拿批次冒充 SN;
 * - 数量只在**有数据的边**上累加;缺数量的边计入 `qtyUnknownEdges`,单独暴露;
 * - 环路必须能终止(现实中不该有,但脏数据会造出来)。
 */

import type { SegmentStat, TraceSegment } from "./trace-coverage";

/** 节点引用:`类型:业务键`,如 `LOT:LOT-2026-001` */
export type NodeRef = string;

export type NodeKind =
  | "SUPPLIER"
  | "PO"
  | "RECEIPT"
  | "LOT"
  | "WO"
  | "FG"
  | "SHIPMENT"
  | "CUSTOMER";

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  SUPPLIER: "供应商",
  PO: "采购订单",
  RECEIPT: "收料批次",
  LOT: "物料批次",
  WO: "生产工单",
  FG: "成品批次",
  SHIPMENT: "出货单",
  CUSTOMER: "客户",
};

export function makeRef(kind: NodeKind, key: string): NodeRef {
  return `${kind}:${key}`;
}

export function parseRef(ref: NodeRef): { kind: NodeKind; key: string } | null {
  const i = ref.indexOf(":");
  if (i < 0) return null;
  const kind = ref.slice(0, i) as NodeKind;
  if (!(kind in NODE_KIND_LABEL)) return null;
  return { kind, key: ref.slice(i + 1) };
}

export interface TraceEdgeInput {
  fromRef: NodeRef;
  toRef: NodeRef;
  kind: string;
  /** 原始数量字段(历史数据);单位换算见下列字段 */
  qty?: string | null;
  occurredAt?: string | null;
  /** ---- 单位换算(PR-E)---- */
  quantity?: string | null;
  uom?: string | null;
  baseQuantity?: string | null;
  baseUom?: string | null;
  conversionFactor?: string | null;
}

/** 正向顺序:每一跳的上游节点类型 → 下游节点类型 */
const FORWARD_ORDER: NodeKind[] = [
  "SUPPLIER",
  "PO",
  "RECEIPT",
  "LOT",
  "WO",
  "FG",
  "SHIPMENT",
  "CUSTOMER",
];

export interface TraverseResult {
  /** 按层展开:layers[0] 是起点本身 */
  layers: NodeRef[][];
  /** 所有触达节点 */
  visited: Set<NodeRef>;
  /** 走过的边 */
  edges: TraceEdgeInput[];
  /** 探测到环路时记录,避免无限循环也便于提示数据有问题 */
  cycles: NodeRef[];
}

function traverse(
  start: NodeRef,
  edges: readonly TraceEdgeInput[],
  direction: "forward" | "backward",
  maxDepth = 12,
): TraverseResult {
  const adjacency = new Map<NodeRef, TraceEdgeInput[]>();
  for (const e of edges) {
    const key = direction === "forward" ? e.fromRef : e.toRef;
    const arr = adjacency.get(key) ?? [];
    arr.push(e);
    adjacency.set(key, arr);
  }

  const visited = new Set<NodeRef>([start]);
  const usedEdges: TraceEdgeInput[] = [];
  const cycles: NodeRef[] = [];
  const layers: NodeRef[][] = [[start]];

  let frontier = [start];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: NodeRef[] = [];
    for (const node of frontier) {
      for (const e of adjacency.get(node) ?? []) {
        const target = direction === "forward" ? e.toRef : e.fromRef;
        usedEdges.push(e);
        if (visited.has(target)) {
          // 已访问 → 环路或菱形结构;记录但不再展开
          if (frontier.includes(target)) cycles.push(target);
          continue;
        }
        visited.add(target);
        next.push(target);
      }
    }
    if (next.length > 0) layers.push(next);
    frontier = next;
  }

  return { layers, visited, edges: usedEdges, cycles };
}

/** 正向追溯:从异常源往下游走(这批料流到哪里去了) */
export function traceForward(start: NodeRef, edges: readonly TraceEdgeInput[]): TraverseResult {
  return traverse(start, edges, "forward");
}

/** 反向追溯:从客户/出货往上游走(这批货是用什么料做的) */
export function traceBackward(start: NodeRef, edges: readonly TraceEdgeInput[]): TraverseResult {
  return traverse(start, edges, "backward");
}

export interface DataGap {
  /** 缺口出现在哪一跳 */
  afterKind: NodeKind;
  expectedKind: NodeKind;
  /** 该层有哪些节点没有下游 */
  danglingRefs: NodeRef[];
  message: string;
  /** 可能原因 —— 直接给人可操作的排查方向 */
  possibleCauses: string[];
}

/**
 * 数据缺口检测。
 *
 * **这是"数据缺失 ≠ 无影响"的落地点。**
 * 例如追到物料批次却没有任何发料记录,不能说"未影响任何工单",
 * 而要说"未发现工单用料记录",并列出可能原因。
 */
export function detectGaps(result: TraverseResult, edges: readonly TraceEdgeInput[]): DataGap[] {
  const gaps: DataGap[] = [];
  const hasOutgoing = new Set(edges.map((e) => e.fromRef));

  const byKind = new Map<NodeKind, NodeRef[]>();
  for (const ref of result.visited) {
    const p = parseRef(ref);
    if (!p) continue;
    const arr = byKind.get(p.kind) ?? [];
    arr.push(ref);
    byKind.set(p.kind, arr);
  }

  const GAP_HINTS: Partial<Record<NodeKind, { next: NodeKind; label: string; causes: string[] }>> = {
    LOT: {
      next: "WO",
      label: "工单用料记录",
      causes: [
        "ERP/MES 尚未同步",
        "导入模板缺少「工单-批次」关系(工单用料模板未导入)",
        "当前批次尚未投产",
      ],
    },
    WO: {
      next: "FG",
      label: "成品批次记录",
      causes: ["工单尚未完工", "成品入库数据未同步", "出货关系模板未导入"],
    },
    FG: {
      next: "SHIPMENT",
      label: "出货记录",
      causes: ["成品尚未出货", "出货关系模板未导入", "ERP 出货数据未同步"],
    },
    RECEIPT: {
      next: "LOT",
      label: "内部物料批次",
      causes: ["收料批次模板未填写内部批次号", "入库过账未同步"],
    },
  };

  for (const [kind, refs] of byKind) {
    const hint = GAP_HINTS[kind];
    if (!hint) continue;
    const dangling = refs.filter((r) => !hasOutgoing.has(r));
    if (dangling.length === 0) continue;
    gaps.push({
      afterKind: kind,
      expectedKind: hint.next,
      danglingRefs: dangling,
      message: `未发现${hint.label} —— 这不代表没有影响,而是这一段数据没有`,
      possibleCauses: hint.causes,
    });
  }

  return gaps;
}

/** 边上的单位信息(PR-E);老数据只有 qty 时这些字段为空 */
export interface EdgeUom {
  quantity?: string | null;
  uom?: string | null;
  baseQuantity?: string | null;
  baseUom?: string | null;
  conversionFactor?: string | null;
}

export interface BlastRadiusInput {
  sourceRef: NodeRef;
  edges: readonly TraceEdgeInput[];
  /** 各成品批次的出货数量(用于"已出货数量") */
  shippedQtyByFgLot?: Record<string, string>;
  /** 各物料批次的在库数量(用于"仍在库存") */
  onHandQtyByLot?: Record<string, string>;
  /** 各工单是否在制 */
  wipWorkOrders?: readonly string[];
  /** 出货单 → 客户 */
  customerByShipment?: Record<string, string>;
}

export interface BlastRadius {
  sourceRef: NodeRef;
  /** 分层展示:第 1 层异常源 → 第 5 层客户与出货 */
  layers: { level: number; kind: NodeKind | "MIXED"; refs: NodeRef[] }[];
  affectedLots: number;
  affectedWorkOrders: number;
  affectedFgLots: number;
  affectedShipments: number;
  affectedCustomers: number;
  /** 数量:**只累加有数据的边**;缺数量的边单列 */
  shippedQty: string;
  onHandQty: string;
  wipWorkOrders: number;
  qtyUnknownEdges: number;
  gaps: DataGap[];
  /** 追溯粒度 —— 一期恒为批次级 */
  granularity: "LOT";
  granularityNote: string;
}

function sumDecimalStrings(values: (string | null | undefined)[]): string {
  let acc = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) acc += n;
  }
  // 保留两位:批次数量通常是整数,但胶/锡膏可能有小数
  return String(Number(acc.toFixed(4)));
}

/**
 * 影响范围计算。
 *
 * 分层与截图一致:异常源 → 关联批次 → 工单 → 成品批次 → 客户与出货。
 */
export function computeBlastRadius(input: BlastRadiusInput): BlastRadius {
  const fwd = traceForward(input.sourceRef, input.edges);
  const gaps = detectGaps(fwd, input.edges);

  const refsOf = (kind: NodeKind) =>
    [...fwd.visited].filter((r) => parseRef(r)?.kind === kind);

  const lots = refsOf("LOT");
  const wos = refsOf("WO");
  const fgs = refsOf("FG");
  const shipments = refsOf("SHIPMENT");
  const customers = new Set<string>();
  for (const s of shipments) {
    const key = parseRef(s)?.key;
    const c = key ? input.customerByShipment?.[key] : undefined;
    if (c) customers.add(c);
  }
  // 图里直接连到客户节点的也算
  for (const c of refsOf("CUSTOMER")) {
    const key = parseRef(c)?.key;
    if (key) customers.add(key);
  }

  const shippedQty = sumDecimalStrings(
    fgs.map((f) => input.shippedQtyByFgLot?.[parseRef(f)?.key ?? ""]),
  );
  const onHandQty = sumDecimalStrings(
    lots.map((l) => input.onHandQtyByLot?.[parseRef(l)?.key ?? ""]),
  );
  const wip = wos.filter((w) => input.wipWorkOrders?.includes(parseRef(w)?.key ?? "")).length;

  const qtyUnknownEdges = fwd.edges.filter((e) => e.qty === null || e.qty === undefined).length;

  const layers = fwd.layers.map((refs, i) => {
    const kinds = new Set(refs.map((r) => parseRef(r)?.kind).filter(Boolean) as NodeKind[]);
    return {
      level: i + 1,
      kind: (kinds.size === 1 ? [...kinds][0] : "MIXED") as NodeKind | "MIXED",
      refs,
    };
  });

  return {
    sourceRef: input.sourceRef,
    layers,
    affectedLots: lots.length,
    affectedWorkOrders: wos.length,
    affectedFgLots: fgs.length,
    affectedShipments: shipments.length,
    affectedCustomers: customers.size,
    shippedQty,
    onHandQty,
    wipWorkOrders: wip,
    qtyUnknownEdges,
    gaps,
    granularity: "LOT",
    granularityNote:
      "当前追溯粒度:批次级 · SN 级追溯待 MES/SN 数据接入(本系统无 SN 数据源,不以批次冒充 SN)",
  };
}

/** 时间线条目(节点 + 事件合并排序) */
export interface TimelineEntry {
  ref: NodeRef;
  occurredAt: string | null;
  label: string;
  kind: NodeKind | null;
}

export function buildTimeline(edges: readonly TraceEdgeInput[]): TimelineEntry[] {
  const seen = new Map<NodeRef, string | null>();
  for (const e of edges) {
    if (!seen.has(e.fromRef)) seen.set(e.fromRef, e.occurredAt ?? null);
    // 目标节点的时间取该跳发生时间(更贴近"它是什么时候出现的")
    const cur = seen.get(e.toRef);
    if (cur === undefined || (cur === null && e.occurredAt)) seen.set(e.toRef, e.occurredAt ?? null);
  }
  return [...seen.entries()]
    .map(([ref, occurredAt]) => {
      const p = parseRef(ref);
      return {
        ref,
        occurredAt,
        kind: p?.kind ?? null,
        label: p ? `${NODE_KIND_LABEL[p.kind]} ${p.key}` : ref,
      };
    })
    .sort((a, b) => {
      // 时间未知的排在最后,**不当成最早**(否则会误导阅读顺序)
      if (a.occurredAt === null && b.occurredAt === null) return 0;
      if (a.occurredAt === null) return 1;
      if (b.occurredAt === null) return -1;
      return a.occurredAt.localeCompare(b.occurredAt);
    });
}

export { FORWARD_ORDER };

/* ============================================================
 * PR-E:分段统计(供覆盖率与置信度计算)
 * ============================================================ */


/** 每一段由哪种边承载 */
const SEGMENT_EDGE_KIND: Record<TraceSegment, TraceEdgeKindName> = {
  RECEIPT: "RECEIPT_TO_LOT",
  ISSUE: "LOT_TO_ISSUE",
  PRODUCTION: "WORK_ORDER_TO_FG_LOT",
  SHIPMENT: "FG_LOT_TO_SHIPMENT",
};

type TraceEdgeKindName =
  | "PO_TO_RECEIPT"
  | "RECEIPT_TO_LOT"
  | "LOT_TO_ISSUE"
  | "ISSUE_TO_WORK_ORDER"
  | "WORK_ORDER_TO_FG_LOT"
  | "FG_LOT_TO_SHIPMENT"
  | "SHIPMENT_TO_CUSTOMER"
  | "LOT_SPLIT"
  | "LOT_MERGE";

/** 每一段的上游节点类型 —— 预期关系数由它推出 */
const SEGMENT_UPSTREAM: Record<TraceSegment, NodeKind> = {
  RECEIPT: "RECEIPT",
  ISSUE: "LOT",
  PRODUCTION: "WO",
  SHIPMENT: "FG",
};

/**
 * 统计各段的"预期 vs 实际"。
 *
 * 预期数 = 该段上游节点的个数(每个上游节点**至少**应有一条下游关系)。
 * 这是保守估计:真实可能一对多,所以覆盖率算出来只会偏低不会偏高 ——
 * 宁可低估自己的数据完整度,也不要高估。
 */
export function segmentStats(
  visited: ReadonlySet<NodeRef>,
  edges: readonly TraceEdgeInput[],
): SegmentStat[] {
  return (Object.keys(SEGMENT_EDGE_KIND) as TraceSegment[]).map((segment) => {
    const upstreamKind = SEGMENT_UPSTREAM[segment];
    const upstreamRefs = [...visited].filter((r) => parseRef(r)?.kind === upstreamKind);
    const edgeKind = SEGMENT_EDGE_KIND[segment];
    const withEdge = new Set(
      edges.filter((e) => e.kind === edgeKind && upstreamRefs.includes(e.fromRef)).map((e) => e.fromRef),
    );
    return {
      segment,
      expected: upstreamRefs.length,
      actual: withEdge.size,
      coverage: null,
    };
  });
}

/** 有时间戳的边占比;没有边时返回 null(不是 1) */
export function timeCompleteness(edges: readonly TraceEdgeInput[]): number | null {
  if (edges.length === 0) return null;
  return edges.filter((e) => Boolean(e.occurredAt)).length / edges.length;
}

/** 数量可折算的边占比;没有边时返回 null */
export function quantityCompleteness(
  edges: readonly TraceEdgeInput[],
  isConvertible: (e: TraceEdgeInput) => boolean,
): number | null {
  if (edges.length === 0) return null;
  return edges.filter(isConvertible).length / edges.length;
}
