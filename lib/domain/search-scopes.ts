/**
 * F1:全局搜索的**范围判定**(纯函数)。
 *
 * SEARCH_SCOPES(lib/rbac.ts)是给人看的中文口径;这里把它映射成
 * 可执行的实体清单 —— 两者必须同源变化,单测里互相锁定。
 * **范围由服务端按会话角色决定**,不接受客户端指定:
 * 传什么搜什么等于把数据范围交给调用方。
 */
import type { RoleName } from "@/lib/routes";

export type SearchEntity =
  | "BOM"
  | "PART"
  | "ECN"
  | "SUPPLIER"
  | "PROCUREMENT_RFQ"
  | "PO"
  | "OPO"
  | "RFQ"
  | "CUSTOMER"
  | "QUOTE";

export const SEARCH_ENTITY_LABEL: Record<SearchEntity, string> = {
  BOM: "BOM",
  PART: "物料",
  ECN: "ECN/BOM 变更记录",
  SUPPLIER: "供应商",
  PROCUREMENT_RFQ: "采购 RFQ",
  PO: "采购 PO",
  OPO: "OPO",
  RFQ: "RFQ",
  CUSTOMER: "客户",
  QUOTE: "报价",
};

/** 与 SEARCH_SCOPES 逐条对应(rbac 中文口径 ↔ 实体) */
const ROLE_ENTITIES: Record<RoleName, readonly SearchEntity[]> = {
  ENGINEERING: ["BOM", "ECN", "PART"],
  PROCUREMENT: ["SUPPLIER", "PROCUREMENT_RFQ", "PO", "OPO"],
  PM: ["RFQ", "CUSTOMER", "QUOTE", "BOM"],
  // MANAGEMENT = 全部实体的并集,但**数据仍是 tenant scope**,不是跨租户
  MANAGEMENT: ["BOM", "PART", "ECN", "SUPPLIER", "PROCUREMENT_RFQ", "PO", "OPO", "RFQ", "CUSTOMER", "QUOTE"],
  // 供应商门户的搜索(OPO 本供应商)属 F6 门户范围,内部搜索不开放
  SUPPLIER: [],
};

export function searchEntitiesFor(roles: readonly RoleName[]): SearchEntity[] {
  const out = new Set<SearchEntity>();
  for (const r of roles) for (const e of ROLE_ENTITIES[r] ?? []) out.add(e);
  return [...out];
}

/** 查询词校验:太短的词全表扫出一堆噪音,不如明说 */
export function normalizeQuery(raw: string | null): { ok: true; q: string } | { ok: false; message: string } {
  const q = (raw ?? "").trim();
  if (q.length < 2) return { ok: false, message: "至少输入 2 个字符" };
  if (q.length > 64) return { ok: false, message: "查询词过长" };
  return { ok: true, q };
}
