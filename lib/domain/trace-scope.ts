/**
 * 追溯可见范围(行级隔离)。
 *
 * 客户要求:「SUPPLIER 仅查看与自身相关的 PO、批次和通知」。
 *
 * 这条要求有**两个方向**的含义,少做任何一边都是漏:
 * ① 横向:不能看到**别家供应商**的批次;
 * ② 纵向:不能看到**下游**——自己那批料流到哪个工单、做成什么成品、卖给了哪个客户,
 *    这些是本厂与其客户之间的商业信息,供应商无权知道。
 *
 * 所以供应商的追溯是**只到上游侧**的截断视图:供应商 → PO → 收料批次 → 物料批次。
 * 页面必须说明这是受限视图,而不是让人以为"下游没有影响"。
 */
import { parseRef, type NodeKind, type NodeRef, type TraceEdgeInput } from "./trace-graph";

export type TraceRole = "INTERNAL" | "SUPPLIER";

/** 供应商可见的节点类型 —— 到物料批次为止,不含工单及其下游 */
export const SUPPLIER_VISIBLE_KINDS: readonly NodeKind[] = ["SUPPLIER", "PO", "RECEIPT", "LOT"];

export interface TraceScope {
  role: TraceRole;
  /** SUPPLIER 时必填:该用户归属的供应商标识(名称或编码) */
  supplierKey?: string | null;
  /** SUPPLIER 时必填:属于该供应商的内部批次号集合(由数据层查好传入) */
  ownLotNos?: readonly string[];
}

export interface ScopeDecision {
  allowed: boolean;
  reason: string | null;
}

/**
 * 能否以某个节点为查询起点。
 *
 * 供应商只能查自己的批次/PO;查别人的一律拒绝 ——
 * 并且**拒绝措辞不能泄露该对象是否存在**(否则可以拿它当探测器枚举别家批次号)。
 */
export function canQueryFrom(ref: NodeRef, scope: TraceScope): ScopeDecision {
  if (scope.role === "INTERNAL") return { allowed: true, reason: null };

  const p = parseRef(ref);
  if (!p) return { allowed: false, reason: "无效的查询对象" };

  if (!SUPPLIER_VISIBLE_KINDS.includes(p.kind)) {
    return {
      allowed: false,
      reason: "供应商账号只能查询与自身相关的 PO 与批次",
    };
  }

  const own = new Set(scope.ownLotNos ?? []);
  if ((p.kind === "LOT" || p.kind === "RECEIPT") && !own.has(p.key)) {
    // 措辞与"不存在"一致,避免被用来枚举别家批次号
    return { allowed: false, reason: "未找到与你相关的批次" };
  }
  if (p.kind === "SUPPLIER" && scope.supplierKey && p.key !== scope.supplierKey) {
    return { allowed: false, reason: "未找到与你相关的批次" };
  }

  return { allowed: true, reason: null };
}

export interface ScopedGraph {
  edges: TraceEdgeInput[];
  /** 因越权被裁掉的边数 —— UI 用它说明"这是受限视图",不是"下游没影响" */
  truncatedEdges: number;
  truncated: boolean;
  notice: string | null;
}

/**
 * 按可见范围裁剪图边。
 *
 * 内部角色原样返回;供应商只保留**两端都可见**的边,
 * 并统计裁掉多少条 —— 这个数字必须显示出来,否则受限视图会被误读成"没有下游影响"。
 */
export function scopeEdges(edges: readonly TraceEdgeInput[], scope: TraceScope): ScopedGraph {
  if (scope.role === "INTERNAL") {
    return { edges: [...edges], truncatedEdges: 0, truncated: false, notice: null };
  }

  const own = new Set(scope.ownLotNos ?? []);
  const visible = (ref: NodeRef): boolean => {
    const p = parseRef(ref);
    if (!p) return false;
    if (!SUPPLIER_VISIBLE_KINDS.includes(p.kind)) return false;
    if (p.kind === "LOT" || p.kind === "RECEIPT") return own.has(p.key);
    if (p.kind === "SUPPLIER") return !scope.supplierKey || p.key === scope.supplierKey;
    return true;
  };

  const kept: TraceEdgeInput[] = [];
  let cut = 0;
  for (const e of edges) {
    if (visible(e.fromRef) && visible(e.toRef)) kept.push(e);
    else cut += 1;
  }

  return {
    edges: kept,
    truncatedEdges: cut,
    truncated: cut > 0,
    notice:
      cut > 0
        ? `这是**受限视图**:供应商账号只显示与自身相关的 PO 与批次,已隐藏 ${cut} 条下游流转关系 —— 隐藏不等于没有影响`
        : null,
  };
}

/** UI 用:该角色下应展示的层级说明 */
export function scopeDescription(scope: TraceScope): string {
  return scope.role === "SUPPLIER"
    ? "供应商视图:仅显示 供应商 → 采购订单 → 收料批次 → 物料批次;下游工单、成品与客户信息不对供应商开放"
    : "内部视图:显示完整链路 供应商 → PO → 收料 → 批次 → 工单 → 成品 → 出货 → 客户";
}
