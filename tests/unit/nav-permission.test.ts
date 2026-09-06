import { describe, expect, it } from "vitest";
import { filterSectionsForRoles, isRouteVisible } from "@/lib/rbac";
import type { AppRoute } from "@/lib/routes";

/** F1:导航按权限真正变化 —— permission 是比角色更细的门,角色满足也不放行 */
const qualityRoute: AppRoute = {
  path: "/quality",
  label: "质量事件",
  permission: "quality.view",
  roles: ["ENGINEERING", "PROCUREMENT", "PM", "MANAGEMENT"],
  plannedPr: "PR-E6",
  implemented: true,
} as AppRoute;

describe("导航权限过滤", () => {
  it("**声明了 permission 就必须持有,角色满足也不放行**", () => {
    expect(isRouteVisible(qualityRoute, ["ENGINEERING"], new Set([]))).toBe(false);
    expect(isRouteVisible(qualityRoute, ["ENGINEERING"], new Set(["quality.view"]))).toBe(true);
  });

  it("MANAGEMENT 被单独回收权限时同样隐藏(权限门先于角色兜底)", () => {
    expect(isRouteVisible(qualityRoute, ["MANAGEMENT"], new Set([]))).toBe(false);
    expect(isRouteVisible(qualityRoute, ["MANAGEMENT"], new Set(["quality.view"]))).toBe(true);
  });

  it("未提供权限上下文时按旧行为只看角色(纯配置渲染兼容)", () => {
    expect(isRouteVisible(qualityRoute, ["ENGINEERING"])).toBe(true);
  });

  it("filterSectionsForRoles 透传权限集,真实菜单里质量事件随权限出没", () => {
    const withPerm = filterSectionsForRoles(["PROCUREMENT"], undefined, new Set(["quality.view"]))
      .flatMap((s) => s.routes)
      .some((r) => r.path === "/quality");
    const without = filterSectionsForRoles(["PROCUREMENT"], undefined, new Set([]))
      .flatMap((s) => s.routes)
      .some((r) => r.path === "/quality");
    expect(withPerm).toBe(true);
    expect(without).toBe(false);
  });
});
