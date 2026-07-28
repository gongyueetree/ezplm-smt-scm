/**
 * RBAC(SPEC §3):角色 → 可见菜单 / 工作台 / 搜索范围。
 * 菜单过滤基于统一 route config(lib/routes.ts),禁止旁路可见性判断。
 */

import { NAV_SECTIONS, type AppRoute, type NavSection, type RoleName } from "./routes";

export const ALL_ROLES: RoleName[] = ["PM", "PROCUREMENT", "ENGINEERING", "MANAGEMENT", "SUPPLIER"];

export const ROLE_LABELS: Record<RoleName, string> = {
  PM: "PM 经理",
  PROCUREMENT: "采购",
  ENGINEERING: "工程",
  MANAGEMENT: "管理层",
  SUPPLIER: "供应商",
};

/** 路由对给定角色集是否可见:未声明 roles = 全员可见;MANAGEMENT 全局可见 */
export function isRouteVisible(route: AppRoute, roles: RoleName[]): boolean {
  if (roles.includes("MANAGEMENT")) return true;
  if (!route.roles || route.roles.length === 0) return true;
  return route.roles.some((r) => roles.includes(r));
}

/** 按角色过滤菜单 section(子路由跟随父路由可见性;空 section 整体隐藏) */
export function filterSectionsForRoles(
  roles: RoleName[],
  sections: NavSection[] = NAV_SECTIONS,
): NavSection[] {
  return sections
    .map((s) => ({ ...s, routes: s.routes.filter((r) => isRouteVisible(r, roles)) }))
    .filter((s) => s.routes.length > 0);
}

/** 搜索范围(SPEC §3 原文映射;PR2 仅配置与展示,搜索实现随功能 PR) */
export const SEARCH_SCOPES: Record<RoleName, string[]> = {
  ENGINEERING: ["BOM", "ECN/BOM 变更记录", "物料"],
  PROCUREMENT: ["供应商", "采购 RFQ", "采购 PO", "OPO"],
  PM: ["RFQ", "客户", "报价", "BOM"],
  MANAGEMENT: ["全局"],
  SUPPLIER: ["OPO(本供应商)"],
};

/** 工作台标题(四个内部工作台 + 供应商门户占位) */
export const WORKBENCH_TITLES: Record<RoleName, string> = {
  PM: "PM 工作台",
  PROCUREMENT: "采购工作台",
  ENGINEERING: "工程工作台",
  MANAGEMENT: "管理工作台",
  SUPPLIER: "供应商协同门户",
};

export interface WorkbenchKpi {
  label: string;
  /** 数据来源模块(诚实 UI:KPI 值待对应 PR 落地,先渲染占位) */
  sourcePr: string;
  ai?: boolean;
}

/** 各工作台 KPI 骨架定义(值全部占位 "—",不渲染假数据) */
export const WORKBENCH_KPIS: Record<RoleName, WorkbenchKpi[]> = {
  PM: [
    { label: "进行中 RFQ", sourcePr: "PR5" },
    { label: "待审批报价", sourcePr: "PR7" },
    { label: "本月已报价", sourcePr: "PR7" },
    { label: "临近截止 RFQ", sourcePr: "PR5" },
  ],
  PROCUREMENT: [
    { label: "待比价采购 RFQ", sourcePr: "PR6" },
    { label: "OPO 未回复行", sourcePr: "PR8" },
    { label: "交期异常行", sourcePr: "PR8" },
    { label: "今日待催办", sourcePr: "PR8" },
  ],
  ENGINEERING: [
    { label: "待匹配 BOM 行", sourcePr: "PR5", ai: true },
    { label: "EOL/停产预警", sourcePr: "PR5" },
    { label: "待确认候选", sourcePr: "PR5" },
    { label: "BOM 版本待比对", sourcePr: "PR5" },
  ],
  MANAGEMENT: [
    { label: "报价汇总", sourcePr: "PR8" },
    { label: "项目毛利", sourcePr: "PR8" },
    { label: "库存/呆滞", sourcePr: "PR8" },
    { label: "DC Aging 预警", sourcePr: "PR8" },
  ],
  SUPPLIER: [
    { label: "待回复 OPO 行", sourcePr: "PR8" },
    { label: "已回复待确认", sourcePr: "PR8" },
  ],
};

/** 会话中多角色用户的主角色(决定工作台形态):按业务优先级取第一个 */
const ROLE_PRIORITY: RoleName[] = ["MANAGEMENT", "PM", "PROCUREMENT", "ENGINEERING", "SUPPLIER"];

export function primaryRole(roles: RoleName[]): RoleName | null {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return null;
}
