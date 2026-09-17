import { describe, expect, it } from "vitest";
import { TENANT_EXEMPT_MODELS, TenantScopeError, assertTenantScopedMutation, checkTenantScopedMutation, tenantData, tenantWhere } from "@/lib/server/tenant-scope";

describe("租户隔离守卫(SPEC §17:tenant 隔离)", () => {
  it("tenantWhere 强制并入 tenantId", () => {
    expect(tenantWhere("t1", { status: "DRAFT" })).toEqual({ status: "DRAFT", tenantId: "t1" });
    expect(tenantWhere("t1")).toEqual({ tenantId: "t1" });
  });

  it("tenantWhere 拒绝跨租户 where", () => {
    expect(() => tenantWhere("t1", { tenantId: "t2" })).toThrow(TenantScopeError);
  });

  it("tenantData 强制携带会话租户并拒绝伪造", () => {
    expect(tenantData("t1", { name: "x" })).toEqual({ name: "x", tenantId: "t1" });
    expect(() => tenantData("t1", { tenantId: "t2", name: "x" })).toThrow(TenantScopeError);
  });

  it("update/delete 仅凭 id 一律拒绝,必须 tenant scoped(CLAUDE.md 约束 4)", () => {
    expect(() => assertTenantScopedMutation("t1", { id: "row1" })).toThrow(TenantScopeError);
    expect(() => assertTenantScopedMutation("t1", undefined)).toThrow(TenantScopeError);
    expect(() => assertTenantScopedMutation("t1", { id: "row1", tenantId: "t2" })).toThrow(
      TenantScopeError,
    );
    expect(() =>
      assertTenantScopedMutation("t1", { id: "row1", tenantId: "t1" }),
    ).not.toThrow();
  });

  it("tenantId 缺失直接拒绝", () => {
    expect(() => tenantWhere("")).toThrow(TenantScopeError);
    expect(() => tenantData("", {})).toThrow(TenantScopeError);
  });
});

describe("R0-5 写操作租户谓词拦截(纯判定)", () => {
  it("裸主键 update/delete 被判违规 —— 这正是审计里 58 处的形态", () => {
    for (const action of ["update", "delete", "updateMany", "deleteMany", "upsert"]) {
      const v = checkTenantScopedMutation("QuoteLine", action, { id: "x" });
      expect(v?.reason).toBe("MISSING_TENANT");
      expect(v?.message).toContain("tenantWhere");
    }
  });

  it("经 tenantWhere 构造的 where 放行", () => {
    expect(checkTenantScopedMutation("QuoteLine", "update", tenantWhere("t1", { id: "x" }))).toBeNull();
  });

  it("缺 where 判 MISSING_WHERE", () => {
    expect(checkTenantScopedMutation("QuoteLine", "delete", undefined)?.reason).toBe("MISSING_WHERE");
  });

  it("读操作与 create 不拦(create 走 tenantData)", () => {
    for (const action of ["findMany", "findFirst", "create", "createMany", "count", "aggregate"]) {
      expect(checkTenantScopedMutation("QuoteLine", action, { id: "x" })).toBeNull();
    }
  });

  it("三个无 tenantId 列的模型显式豁免,其余一律受管", () => {
    for (const m of ["Tenant", "CanonicalManufacturerRef", "RateLimitBucket"]) {
      expect(checkTenantScopedMutation(m, "update", { id: "x" })).toBeNull();
      expect(TENANT_EXEMPT_MODELS.has(m)).toBe(true);
    }
    expect(checkTenantScopedMutation("PartMfgMapping", "update", { id: "x" })).not.toBeNull();
  });

  it("豁免名单必须与 schema 同步 —— 新增无 tenantId 的模型不得默默放过", () => {
    // 与 prisma/schema.prisma 实际情况对齐;新增模型若无 tenantId,必须显式登记
    expect([...TENANT_EXEMPT_MODELS].sort()).toEqual([
      "CanonicalManufacturerRef",
      "RateLimitBucket",
      "Tenant",
    ]);
  });
});
describe("R0-5 复合唯一键不得误报", () => {
  it("upsert 用复合唯一键选择器,tenantId 在里层 —— 属合法 scoped", () => {
    const where = {
      tenantId_partId_definitionId: { tenantId: "t1", partId: "p1", definitionId: "d1" },
    };
    expect(checkTenantScopedMutation("PartAttributeValue", "upsert", where)).toBeNull();
  });

  it("里层没有 tenantId 的复合键仍判违规", () => {
    const where = { partId_definitionId: { partId: "p1", definitionId: "d1" } };
    expect(checkTenantScopedMutation("PartAttributeValue", "upsert", where)?.reason).toBe(
      "MISSING_TENANT",
    );
  });

  it("数组值不被当成复合键对象(避免把 { id: { in: [...] } } 误判为已 scoped)", () => {
    expect(checkTenantScopedMutation("Part", "updateMany", { id: { in: ["a", "b"] } })?.reason).toBe(
      "MISSING_TENANT",
    );
  });
});
