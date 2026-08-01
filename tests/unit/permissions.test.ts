import { describe, expect, it } from "vitest";
import {
  effectivePermissions,
  explainPermissions,
  hasPermission,
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from "@/lib/auth/permissions";

describe("权限体系:不新增硬编码角色,用权限串组合", () => {
  it("角色默认权限生效", () => {
    const p = effectivePermissions(["ENGINEERING"]);
    expect(hasPermission(p, "material.create")).toBe(true);
    expect(hasPermission(p, "trace.containment.propose")).toBe(true);
  });

  it("**提议与批准分离** —— 工程能提隔离,但不能批", () => {
    const eng = effectivePermissions(["ENGINEERING"]);
    expect(hasPermission(eng, "trace.containment.propose")).toBe(true);
    expect(hasPermission(eng, "trace.containment.approve")).toBe(false);
    expect(hasPermission(effectivePermissions(["MANAGEMENT"]), "trace.containment.approve")).toBe(true);
  });

  it("PM / 采购默认不能建料(只读)", () => {
    for (const r of ["PM", "PROCUREMENT"] as const) {
      const p = effectivePermissions([r]);
      expect(hasPermission(p, "material.view")).toBe(true);
      expect(hasPermission(p, "material.create")).toBe(false);
    }
  });

  it("ERP 连接配置默认只给管理层 —— 那里有凭据", () => {
    expect(hasPermission(effectivePermissions(["PROCUREMENT"]), "erp.connection.manage")).toBe(false);
    expect(hasPermission(effectivePermissions(["MANAGEMENT"]), "erp.connection.manage")).toBe(true);
  });

  it("「系统管理员」由**租户级授予**表达,不新增角色", () => {
    const p = effectivePermissions(
      ["PROCUREMENT"],
      [{ role: "PROCUREMENT", permission: "erp.connection.manage" }],
    );
    expect(hasPermission(p, "erp.connection.manage")).toBe(true);
  });

  it("租户授予只对**该角色**生效,不会串到别的角色", () => {
    const p = effectivePermissions(["PM"], [{ role: "PROCUREMENT", permission: "erp.mapping.manage" }]);
    expect(hasPermission(p, "erp.mapping.manage")).toBe(false);
  });

  it("**用户级可以明确回收** —— 即便角色默认有也不给", () => {
    const p = effectivePermissions(["MANAGEMENT"], [], [
      { permission: "erp.connection.manage", granted: false },
    ]);
    expect(hasPermission(p, "erp.connection.manage")).toBe(false);
    expect(hasPermission(p, "material.create")).toBe(true);
  });

  it("用户级授予优先于角色默认的缺失", () => {
    const p = effectivePermissions(["PM"], [], [{ permission: "material.create", granted: true }]);
    expect(hasPermission(p, "material.create")).toBe(true);
  });

  it("未知权限串被忽略,不会污染权限集", () => {
    const p = effectivePermissions(["PM"], [{ role: "PM", permission: "not.a.permission" }], [
      { permission: "also.bogus", granted: true },
    ]);
    expect([...p].every((x) => (PERMISSIONS as readonly string[]).includes(x))).toBe(true);
  });

  it("SUPPLIER 只有 trace.view —— 可见范围靠行级过滤而不是页面级糊弄", () => {
    expect(ROLE_DEFAULT_PERMISSIONS.SUPPLIER).toEqual(["trace.view"]);
  });

  it("多角色取并集", () => {
    const p = effectivePermissions(["PM", "ENGINEERING"]);
    expect(hasPermission(p, "material.create")).toBe(true);
    expect(hasPermission(p, "trace.export")).toBe(true);
  });
});

describe("explainPermissions:回答「他为什么有这个权限」", () => {
  it("角色默认给的,来源标为 ROLE_DEFAULT", () => {
    const e = explainPermissions(["ENGINEERING"]).find((x) => x.permission === "material.create")!;
    expect(e.granted).toBe(true);
    expect(e.decidedBy).toBe("ROLE_DEFAULT");
    expect(e.trail[0].detail).toContain("ENGINEERING");
  });

  it("租户额外授予的,来源标为 TENANT_GRANT 并保留完整链路", () => {
    const e = explainPermissions(
      ["PROCUREMENT"],
      [{ role: "PROCUREMENT", permission: "erp.connection.manage" }],
    ).find((x) => x.permission === "erp.connection.manage")!;
    expect(e.granted).toBe(true);
    expect(e.decidedBy).toBe("TENANT_GRANT");
  });

  it("**用户级回收要能看出是被谁否掉的**", () => {
    const e = explainPermissions(["MANAGEMENT"], [], [
      { permission: "erp.connection.manage", granted: false },
    ]).find((x) => x.permission === "erp.connection.manage")!;
    expect(e.granted).toBe(false);
    expect(e.decidedBy).toBe("USER_REVOKE");
    // 链路要保留"角色本来是给的"这一步,否则排查时看不出冲突在哪
    expect(e.trail.some((t) => t.source === "ROLE_DEFAULT")).toBe(true);
    expect(e.trail[e.trail.length - 1].detail).toContain("覆盖前面所有授予");
  });

  it("没有任何来源时标 NONE 且不授予", () => {
    const e = explainPermissions(["PM"]).find((x) => x.permission === "material.create")!;
    expect(e.granted).toBe(false);
    expect(e.decidedBy).toBe("NONE");
    expect(e.trail).toEqual([]);
  });

  it("解释覆盖全部权限串,不漏项", () => {
    expect(explainPermissions(["PM"])).toHaveLength(PERMISSIONS.length);
  });

  it("权限管理权默认只给 MANAGEMENT", () => {
    expect(effectivePermissions(["MANAGEMENT"]).has("settings.permissions.manage")).toBe(true);
    for (const r of ["PM", "PROCUREMENT", "ENGINEERING", "SUPPLIER"] as const) {
      expect(effectivePermissions([r]).has("settings.permissions.manage")).toBe(false);
    }
  });
});
