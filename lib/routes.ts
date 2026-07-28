/**
 * 统一路由配置(SPEC §2)。
 * 左侧菜单、面包屑、返回上一层按钮全部由本文件派生,
 * 禁止任何页面自带一套导航(SPEC §2 第 25 条)。
 */

export type IconName =
  | "home"
  | "quote"
  | "bom"
  | "db"
  | "cart"
  | "handshake"
  | "clock"
  | "ledger"
  | "alert"
  | "box"
  | "gear"
  | "scale"
  | "calendar";

/** 角色名(与 prisma RoleName 枚举一致;仅此五值) */
export type RoleName = "PM" | "PROCUREMENT" | "ENGINEERING" | "MANAGEMENT" | "SUPPLIER";

export interface AppRoute {
  /** 以 / 开头的完整路径 */
  path: string;
  label: string;
  icon?: IconName;
  /** AI 增强模块(紫色标识,人工确认闭环) */
  ai?: boolean;
  /** 该模块计划落地的 PR(诚实 UI:占位页如实标注) */
  plannedPr: string;
  /** 占位页说明 */
  desc: string;
  /**
   * 可见角色(SPEC §3)。缺省 = 所有角色可见;
   * MANAGEMENT 全局可见,不受此限制(见 rbac.ts filterSectionsForRoles)。
   */
  roles?: RoleName[];
  children?: AppRoute[];
}

export interface NavSection {
  title: string;
  routes: AppRoute[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "总览",
    routes: [
      {
        path: "/",
        label: "工作台",
        icon: "home",
        plannedPr: "PR2",
        desc: "角色化工作台(PM / 采购 / 工程 / 管理),角色切换联动菜单、KPI 与搜索范围。",
      },
    ],
  },
  {
    title: "报价与客户",
    routes: [
      {
        path: "/rfq",
        label: "RFQ 询价",
        icon: "quote",
        plannedPr: "PR5",
        desc: "创建 RFQ、多 BOM 与附件上传、状态机流转、不报价关闭。",
        roles: ["PM"],
      },
      {
        path: "/quotes",
        label: "报价管理",
        icon: "ledger",
        ai: true,
        plannedPr: "PR7",
        desc: "报价拆分(材料/人工/NRE/SMT/DIP/测试/管理费)、Markup/PPV、版本快照与审批。",
        roles: ["PM"],
      },
    ],
  },
  {
    title: "BOM 与物料",
    routes: [
      {
        path: "/bom",
        label: "BOM 管理",
        icon: "bom",
        plannedPr: "PR5",
        desc: "BOM 台账、版本管理、组合筛选。",
        roles: ["PM", "ENGINEERING"],
        children: [
          {
            path: "/bom/import",
            label: "BOM 导入",
            ai: true,
            plannedPr: "PR5",
            desc: "CSV/XLSX/图片/PDF 多文件导入、列映射、校验、智能匹配(人工确认)。大 BOM 走 ImportJob 分批。",
          },
          {
            path: "/bom/compare",
            label: "版本比对",
            plannedPr: "PR5",
            desc: "BOM 版本差异比对,导入完成后直接进入。",
          },
        ],
      },
      {
        path: "/materials",
        label: "物料查询",
        icon: "db",
        plannedPr: "PR5",
        desc: "物料主数据查询(ezPLM 只读真源 + ExternalPartSnapshot 缓存),候选显示生命周期/库存/呆滞/OPO/数据更新时间。",
        roles: ["ENGINEERING", "PROCUREMENT"],
      },
    ],
  },
  {
    title: "采购协同",
    routes: [
      {
        path: "/procurement/rfq",
        label: "采购 RFQ 比价",
        icon: "scale",
        ai: true,
        plannedPr: "PR6",
        desc: "ezPLM / DigiKey / Mouser / 线下 Excel 统一 NormalizedOffer 比价,推荐可改可拒,保存选择理由。",
        roles: ["PROCUREMENT"],
      },
      {
        path: "/procurement/orders",
        label: "采购订单",
        icon: "cart",
        plannedPr: "PR6/PR8",
        desc: "采购订单台账与 ERP 导出模板(API 不可回写时的替代路径)。",
        roles: ["PROCUREMENT"],
      },
      {
        path: "/suppliers/opo",
        label: "OPO 交期协同",
        icon: "clock",
        plannedPr: "PR8",
        desc: "行级 OPOLine 唯一数据源,KPI/未回复/差异/异常全部派生;提前 4 天催办 Cron。",
        roles: ["PROCUREMENT", "SUPPLIER"],
      },
    ],
  },
  {
    title: "履约与对账",
    routes: [
      {
        path: "/reconciliation",
        label: "AR/AP 对账",
        icon: "ledger",
        plannedPr: "PR8",
        desc: "AR 与 AP 按角色与 Tab 区分,对账单发送走邮件适配器(预览/模拟)。",
        roles: ["PM", "PROCUREMENT"],
      },
      {
        path: "/shortage",
        label: "缺料分析",
        icon: "alert",
        plannedPr: "PR8",
        desc: "缺料分析与 Call 料表。",
        roles: ["PROCUREMENT"],
      },
      {
        path: "/kitting",
        label: "齐料检查",
        icon: "box",
        plannedPr: "PR8",
        desc: "工单齐料检查(GTB:ceil(需求×(1+损耗率)) − 库存 − 在途,≥MOQ 再按 SPQ 向上圆整)。",
        roles: ["PROCUREMENT", "ENGINEERING"],
      },
      {
        path: "/inventory",
        label: "库存总览",
        icon: "calendar",
        plannedPr: "PR8",
        desc: "库存与呆滞总览(ezPLM 只读数据源),按客户/日期筛选。",
        roles: ["PROCUREMENT"],
      },
    ],
  },
  {
    title: "平台",
    routes: [
      {
        path: "/settings",
        label: "系统设置",
        icon: "gear",
        plannedPr: "PR2",
        desc: "租户、用户与角色管理;集成状态只用 待确认/待授权/待联调/示例配置。",
        roles: ["MANAGEMENT"],
      },
    ],
  },
];

/** 展平全部路由(含子路由) */
export function flattenRoutes(sections: NavSection[] = NAV_SECTIONS): AppRoute[] {
  const out: AppRoute[] = [];
  const walk = (r: AppRoute) => {
    out.push(r);
    r.children?.forEach(walk);
  };
  sections.forEach((s) => s.routes.forEach(walk));
  return out;
}

/** 按路径精确查找路由 */
export function findRoute(path: string): AppRoute | undefined {
  const normalized = path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
  return flattenRoutes().find((r) => r.path === normalized);
}

/** 上一层路径:/bom/import → /bom;顶级路由 → /;根路径 → null */
export function parentPath(path: string): string | null {
  if (path === "/") return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return "/";
  return "/" + segments.slice(0, -1).join("/");
}

/**
 * 返回上一层的实际目标:逐级向上找最近的已配置路由
 * (如 /procurement/rfq 的上一层 /procurement 未配置页面,则回到 /)。
 */
export function backTarget(path: string): AppRoute | null {
  let p = parentPath(path);
  while (p) {
    const r = findRoute(p);
    if (r) return r;
    p = parentPath(p);
  }
  return null;
}

/** 面包屑:从根到当前路径上所有已配置的路由 */
export function breadcrumbFor(path: string): AppRoute[] {
  const segments = path.split("/").filter(Boolean);
  const crumbs: AppRoute[] = [];
  const root = findRoute("/");
  if (root) crumbs.push(root);
  let acc = "";
  for (const seg of segments) {
    acc += `/${seg}`;
    const r = findRoute(acc);
    if (r) crumbs.push(r);
  }
  return crumbs;
}
