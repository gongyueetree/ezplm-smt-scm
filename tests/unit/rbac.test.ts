import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  SEARCH_SCOPES,
  WORKBENCH_KPIS,
  WORKBENCH_TITLES,
  filterSectionsForRoles,
  isRouteVisible,
  primaryRole,
} from "@/lib/rbac";
import { flattenRoutes } from "@/lib/routes";

describe("RBAC 菜单过滤(SPEC §3)", () => {
  it("MANAGEMENT 全局可见:看到全部 15 条路由", () => {
    const sections = filterSectionsForRoles(["MANAGEMENT"]);
    const paths = sections.flatMap((s) => s.routes).flatMap((r) => [r, ...(r.children ?? [])]);
    expect(paths.length).toBe(flattenRoutes().length);
  });

  it("PM 可见报价与客户/BOM,不可见采购 RFQ 与系统设置", () => {
    const sections = filterSectionsForRoles(["PM"]);
    const paths = sections.flatMap((s) => s.routes).map((r) => r.path);
    expect(paths).toContain("/rfq");
    expect(paths).toContain("/quotes");
    expect(paths).toContain("/bom");
    expect(paths).not.toContain("/procurement/rfq");
    expect(paths).not.toContain("/settings");
  });

  it("PROCUREMENT 可见采购协同,不可见 RFQ 询价/报价管理", () => {
    const sections = filterSectionsForRoles(["PROCUREMENT"]);
    const paths = sections.flatMap((s) => s.routes).map((r) => r.path);
    expect(paths).toContain("/procurement/rfq");
    expect(paths).toContain("/suppliers/opo");
    expect(paths).not.toContain("/rfq");
    expect(paths).not.toContain("/quotes");
  });

  it("ENGINEERING 可见 BOM/物料,不可见采购与设置", () => {
    const sections = filterSectionsForRoles(["ENGINEERING"]);
    const paths = sections.flatMap((s) => s.routes).map((r) => r.path);
    expect(paths).toContain("/bom");
    expect(paths).toContain("/materials");
    expect(paths).not.toContain("/procurement/rfq");
    expect(paths).not.toContain("/settings");
  });

  it("SUPPLIER 仅可见工作台与 OPO 协同", () => {
    const sections = filterSectionsForRoles(["SUPPLIER"]);
    const paths = sections.flatMap((s) => s.routes).map((r) => r.path);
    expect(paths).toEqual(["/", "/suppliers/opo"]);
  });

  it("空 section 整体隐藏", () => {
    const sections = filterSectionsForRoles(["SUPPLIER"]);
    for (const s of sections) expect(s.routes.length).toBeGreaterThan(0);
  });

  it("未声明 roles 的路由对全员可见", () => {
    const home = flattenRoutes().find((r) => r.path === "/")!;
    for (const role of ALL_ROLES) expect(isRouteVisible(home, [role])).toBe(true);
  });
});

describe("搜索范围与工作台配置(SPEC §3)", () => {
  it("搜索范围与 SPEC §3 原文一致", () => {
    expect(SEARCH_SCOPES.ENGINEERING).toEqual(["BOM", "ECN/BOM 变更记录", "物料"]);
    expect(SEARCH_SCOPES.PROCUREMENT).toEqual(["供应商", "采购 RFQ", "采购 PO", "OPO"]);
    expect(SEARCH_SCOPES.PM).toEqual(["RFQ", "客户", "报价", "BOM"]);
    expect(SEARCH_SCOPES.MANAGEMENT).toEqual(["全局"]);
  });

  it("五角色均有工作台标题与 KPI 骨架定义", () => {
    for (const role of ALL_ROLES) {
      expect(WORKBENCH_TITLES[role].length).toBeGreaterThan(0);
      expect(WORKBENCH_KPIS[role].length).toBeGreaterThan(0);
    }
  });

  it("primaryRole 按业务优先级取主角色", () => {
    expect(primaryRole(["ENGINEERING", "MANAGEMENT"])).toBe("MANAGEMENT");
    expect(primaryRole(["PROCUREMENT", "PM"])).toBe("PM");
    expect(primaryRole([])).toBeNull();
  });
});
