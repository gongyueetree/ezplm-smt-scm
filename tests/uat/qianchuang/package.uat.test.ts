/**
 * R4-4 私有 UAT:整包计划(解析/校验/对账)对真实 7 文件的断言(§41)。
 * 全部重新计算,不硬编码猜测;真实数据的 referential 缺口**如实断言存在**,
 * 不为绿灯补造关系。持久化路径由 CLI 对 scratch 库实测(见 PR 描述)。
 */
import { describe, expect, it } from "vitest";
import { buildUatPackagePlan } from "@/lib/integration/erp/uat-package";

const dir = process.env.QIANCHUANG_UAT_FIXTURE_DIR!;

describe("UAT Package 计划(STRICT_UAT)", () => {
  it("§41 结构特征全断言:N:M/无MPN/多义/双货主/未解析引用 > 0;STRICT 可提交", async () => {
    const plan = await buildUatPackagePlan(dir, "STRICT_UAT");

    // 规模(±,重新计算)
    const rows = Object.fromEntries(plan.files.map((f) => [f.role, f.rows]));
    expect(rows.MATERIAL).toBe(16209);
    expect(rows.INVENTORY).toBe(4455);
    expect(rows.EXCESS).toBe(1569);
    expect(rows.SUPPLIER).toBe(629);
    expect(rows.CUSTOMER).toBe(201);
    expect(rows.PURCHASE_ORDER).toBe(638);
    expect(rows.MATERIAL_MFG).toBeGreaterThan(50000);

    // Material without MPN:canonical 无 MPN 字段位,且 16K 全解析零 issue
    expect(plan.issueCounts["INVALID_DECIMAL"] ?? 0).toBe(0);
    expect(plan.issueCounts["INVALID_DATE"] ?? 0).toBe(0);
    expect(plan.admissible).toBe(true);

    const r = plan.reconciliation;
    // internalPn → 多 MFG_PN 与反向(经 mfg 文件;N:M)
    expect(r.mfgRowsHitMaterial).toBeGreaterThan(20000);
    expect(r.mfgRowsOrphan).toBeGreaterThan(20000); // 导出口径缺料,如实存在
    // Customer-owned 与 Organization-owned 并存;客户货主 20 个全未解析(脱敏不一致)
    expect(r.inventoryCustomerOwnersUnique).toBeGreaterThan(10);
    expect(r.inventoryCustomerOwnersUnresolved).toBeGreaterThan(0);
    // 未解析引用 > 0(真实数据不是 100% RI;不自动补造)
    expect(r.inventoryRowsOrphan).toBeGreaterThan(1000);
    expect(r.poSuppliersUnique).toBeGreaterThan(50);
    // override 只覆盖零星测试映射;大量供应商名仍未解析(正式对照表待乾创)
    expect(r.poSuppliersUnique - r.poSuppliersResolved).toBeGreaterThan(50);
    // PO MFG 证据存在
    expect(r.poMfgEvidenceRows).toBeGreaterThan(100);

    // datasetVersion 可复现:同一目录再算一次 hash 相同(§39/§41 可重复)
    const plan2 = await buildUatPackagePlan(dir, "STRICT_UAT");
    expect(plan2.datasetVersion).toBe(plan.datasetVersion);
  });

  it("DEMO_LENIENT 与 STRICT 对同一干净包同判(乾创包本身零非法值)", async () => {
    const lenient = await buildUatPackagePlan(dir, "DEMO_LENIENT");
    expect(lenient.admissible).toBe(true);
  });
});
