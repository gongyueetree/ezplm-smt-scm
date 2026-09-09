/**
 * R3-8(P2-4):golden 安全矩阵 —— 租户/客户隔离的 fail-closed 场景
 * 在**生产守卫函数**上逐项断言(此前隔离只在 E2E 层,golden 层缺位)。
 *
 * 纪律与其它金样一致:期望由构造推导(TENANT_A/B、CUSTOMER_A/B 的行数
 * 与去向在构造时即确定),不抄快照。
 */
import { describe, expect, it } from "vitest";
import {
  TenantScopeError,
  assertTenantScopedMutation,
  tenantData,
  tenantWhere,
} from "@/lib/server/tenant-scope";
import { scopePortalRows } from "@/lib/server/portal";
import { buildAuditRecord, AuditRedactionError } from "@/lib/server/audit";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const CUSTOMER_A = "CUS-A";
const CUSTOMER_B = "CUS-B";

describe("golden · 租户隔离守卫(fail-closed)", () => {
  it("tenantWhere:B 租户注入 where.tenantId 一律抛错,不静默改写", () => {
    expect(() => tenantWhere(TENANT_A, { tenantId: TENANT_B })).toThrow(TenantScopeError);
    // 同租户显式给出 = 合法;缺省时强制并入
    expect(tenantWhere(TENANT_A, { id: "x" })).toEqual({ id: "x", tenantId: TENANT_A });
    expect(tenantWhere(TENANT_A, { tenantId: TENANT_A })).toEqual({ tenantId: TENANT_A });
  });

  it("tenantData:跨租户写入数据被拒;空租户被拒", () => {
    expect(() => tenantData(TENANT_A, { tenantId: TENANT_B, x: 1 })).toThrow(TenantScopeError);
    expect(() => tenantWhere("", {})).toThrow(TenantScopeError);
    expect(tenantData(TENANT_A, { x: 1 })).toEqual({ x: 1, tenantId: TENANT_A });
  });

  it("assertTenantScopedMutation:仅主键 / 无 where / 错租户 全部拒绝", () => {
    expect(() => assertTenantScopedMutation(TENANT_A, undefined)).toThrow(TenantScopeError);
    expect(() => assertTenantScopedMutation(TENANT_A, { id: "row-1" })).toThrow(TenantScopeError);
    expect(() => assertTenantScopedMutation(TENANT_A, { id: "row-1", tenantId: TENANT_B })).toThrow(
      TenantScopeError,
    );
    expect(() => assertTenantScopedMutation(TENANT_A, { id: "row-1", tenantId: TENANT_A })).not.toThrow();
  });
});

describe("golden · 客户 scope + DTO 白名单(门户出数纯函数)", () => {
  // 构造:A 客户 3 行、B 客户 2 行、无归属 1 行;每行都带**投毒字段**
  // (单价/供应商/内部备注)—— 白名单映射后必须一个都不剩
  const poisoned = [
    ...Array.from({ length: 3 }, (_, i) => ({
      customerCode: CUSTOMER_A,
      materialCode: `MAT-A${i}`,
      qty: `${100 + i}`,
      unitPrice: "99.99",
      supplierCode: "SUP-SECRET",
      internalNote: "成本红线,勿外传",
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      customerCode: CUSTOMER_B,
      materialCode: `MAT-B${i}`,
      qty: `${200 + i}`,
      unitPrice: "88.88",
      supplierCode: "SUP-SECRET",
      internalNote: "x",
    })),
    { customerCode: null, materialCode: "MAT-PUB", qty: "7", unitPrice: "1", supplierCode: "S", internalNote: "x" },
  ];
  const toRow = (r: (typeof poisoned)[number]) => ({ materialCode: r.materialCode, qty: r.qty });

  it("CUSTOMER_A 视角:只见自己的 3 行;越界 3 行(B 的 2 + 无归属 1)全部丢弃并如实计数", () => {
    const { rows, leaked } = scopePortalRows(CUSTOMER_A, poisoned, toRow);
    expect(rows).toHaveLength(3);
    expect(leaked).toBe(3);
    expect(rows.every((r) => r.materialCode.startsWith("MAT-A"))).toBe(true);
  });

  it("CUSTOMER_B 视角对称;未知客户 fail-closed 得 0 行", () => {
    expect(scopePortalRows(CUSTOMER_B, poisoned, toRow).rows).toHaveLength(2);
    expect(scopePortalRows("CUS-NOBODY", poisoned, toRow)).toEqual({ rows: [], leaked: 6 });
  });

  it("白名单序列化:输出键**恰好**是白名单,投毒字段(单价/供应商/内部备注)一个不剩", () => {
    const { rows } = scopePortalRows(CUSTOMER_A, poisoned, toRow);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["materialCode", "qty"]);
    }
    expect(JSON.stringify(rows)).not.toMatch(/unitPrice|supplierCode|internalNote|SUP-SECRET|99\.99/);
  });

  it("大小写归一:provider 返回小写客户码仍归属正确(不因大小写漏行/串行)", () => {
    const rows = [{ customerCode: "cus-a", materialCode: "M", qty: "1" }];
    const pick = (r: (typeof rows)[number]) => ({ materialCode: r.materialCode, qty: r.qty });
    expect(scopePortalRows(CUSTOMER_A, rows, pick).rows).toHaveLength(1);
    expect(scopePortalRows(CUSTOMER_B, rows, pick).rows).toHaveLength(0);
  });
});

describe("golden · 审计载荷红线(凭据永不入 append-only 日志)", () => {
  const base = { tenantId: TENANT_A, userId: "u1", action: "A", entityType: "T", entityId: "e1" };

  it("password/passwordHash/tokenHash/secret/apiKey/authorization 键在任意深度都被拒", () => {
    for (const bad of [
      { after: { password: "x" } },
      { after: { passwordHash: "x" } },
      { after: { tokenHash: "f".repeat(64) } },
      { after: { nested: { config: { apiKey: "k" } } } },
      { before: { headers: { Authorization: "Bearer x" } } },
      { after: { list: [{ secret: "s" }] } },
    ]) {
      expect(() => buildAuditRecord({ ...base, ...bad })).toThrow(AuditRedactionError);
    }
  });

  it("tokenRef(hash 前 8 位)与普通业务键放行", () => {
    expect(() =>
      buildAuditRecord({ ...base, after: { tokenRef: "ab12cd34", poNo: "PO-1", ip: "1.2.3.4" } }),
    ).not.toThrow();
  });
});
