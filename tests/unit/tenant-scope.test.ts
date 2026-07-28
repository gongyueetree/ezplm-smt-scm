import { describe, expect, it } from "vitest";
import {
  TenantScopeError,
  assertTenantScopedMutation,
  tenantData,
  tenantWhere,
} from "@/lib/server/tenant-scope";

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
