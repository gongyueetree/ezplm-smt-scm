import { describe, expect, it } from "vitest";
import { SEARCH_SCOPES } from "@/lib/rbac";
import {
  SEARCH_ENTITY_LABEL,
  normalizeQuery,
  searchEntitiesFor,
} from "@/lib/domain/search-scopes";

/**
 * F1:搜索范围映射与 rbac 的中文口径**互相锁定** ——
 * 改了一边忘了另一边,这里会红。
 */
describe("搜索范围", () => {
  it("ENGINEERING = BOM / ECN变更 / 物料(与 SEARCH_SCOPES 一致)", () => {
    const labels = searchEntitiesFor(["ENGINEERING"]).map((e) => SEARCH_ENTITY_LABEL[e]);
    expect(labels.sort()).toEqual([...SEARCH_SCOPES.ENGINEERING].sort());
  });

  it("PROCUREMENT 搜不到客户与报价;PM 搜不到供应商", () => {
    expect(searchEntitiesFor(["PROCUREMENT"])).not.toContain("CUSTOMER");
    expect(searchEntitiesFor(["PROCUREMENT"])).not.toContain("QUOTE");
    expect(searchEntitiesFor(["PM"])).not.toContain("SUPPLIER");
  });

  it("MANAGEMENT 是并集(跨模块但仍 tenant scope,不是跨租户)", () => {
    const m = searchEntitiesFor(["MANAGEMENT"]);
    for (const e of [...searchEntitiesFor(["PM"]), ...searchEntitiesFor(["PROCUREMENT"]), ...searchEntitiesFor(["ENGINEERING"])]) {
      expect(m).toContain(e);
    }
  });

  it("SUPPLIER 不开放内部搜索(门户搜索属 F6)", () => {
    expect(searchEntitiesFor(["SUPPLIER"])).toEqual([]);
  });

  it("多角色取并集", () => {
    const both = searchEntitiesFor(["PM", "PROCUREMENT"]);
    expect(both).toContain("QUOTE");
    expect(both).toContain("SUPPLIER");
  });

  it("查询词:太短/过长拒绝并说明", () => {
    expect(normalizeQuery("a")).toMatchObject({ ok: false });
    expect(normalizeQuery("  ab ")).toEqual({ ok: true, q: "ab" });
    expect(normalizeQuery("x".repeat(65))).toMatchObject({ ok: false });
  });
});
