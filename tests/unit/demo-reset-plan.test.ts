/**
 * 演示环境重置的表分类。
 *
 * 这里最重要的一条是**穷尽性**:清库脚本最危险的失败不是"删错了",
 * 而是新增一张表却没人想起来分类 —— 客户看到"清理过"的系统里还挂着
 * 上一轮的单据。所以直接拿 Prisma 的真实模型清单来比对:
 * 将来加表忘了分类,这条用例就红,而不是等到线上才发现。
 */
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  clientKey,
  KEEP_MODELS,
  PURGE_MODELS,
  verifyPlanCoverage,
} from "@/lib/domain/demo-reset-plan";

const ACTUAL_MODELS = Prisma.dmmf.datamodel.models.map((m) => m.name);

describe("表分类的穷尽性(对齐真实 schema)", () => {
  it("**每一张表都必须被分类** —— 新增表忘了归类时这条会红", () => {
    const r = verifyPlanCoverage(ACTUAL_MODELS);
    expect(r.unclassified, `未分类的表:${r.unclassified.join(", ")}`).toEqual([]);
    expect(r.stale, `名单里有但 schema 已无:${r.stale.join(", ")}`).toEqual([]);
    expect(r.conflicting, `同时出现在两张名单:${r.conflicting.join(", ")}`).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("两张名单加起来正好等于全部模型数,不多不少", () => {
    expect(PURGE_MODELS.length + KEEP_MODELS.length).toBe(ACTUAL_MODELS.length);
  });

  it("名单内部没有重复项", () => {
    expect(new Set(PURGE_MODELS).size).toBe(PURGE_MODELS.length);
    expect(new Set(KEEP_MODELS).size).toBe(KEEP_MODELS.length);
  });
});

describe("哪些必须保住 —— 清完还得能演示", () => {
  it("账号与租户绝不能被清 —— 清了客户就登不进来了", () => {
    for (const m of ["Tenant", "User", "Role", "UserRole", "UserPermission", "PermissionGrant"]) {
      expect(KEEP_MODELS as readonly string[], m).toContain(m);
      expect(PURGE_MODELS as readonly string[], m).not.toContain(m);
    }
  });

  it("主数据与配置必须保住 —— 清了就不是「清理」而是「废掉」", () => {
    for (const m of [
      "Part",
      "Supplier",
      "Customer",
      "InventorySnapshot",
      "OpenPOLine",
      "QuoteTemplate",
      "ProcurementPolicy",
      "ErpConnection",
      "ErpCredential",
    ]) {
      expect(KEEP_MODELS as readonly string[], m).toContain(m);
    }
  });

  it("审计日志默认保留 —— 先删审计再写审计会让人误以为系统从没被用过", () => {
    expect(KEEP_MODELS as readonly string[]).toContain("AuditLog");
    expect(PURGE_MODELS as readonly string[]).not.toContain("AuditLog");
  });
});

describe("哪些该清 —— 测试期产生的单据", () => {
  it("各业务域的单据都在清理名单里", () => {
    for (const m of [
      "RFQ",
      "BOM",
      "BOMLine",
      "Quote",
      "QuoteLine",
      "PurchaseOrder",
      "PurchaseOrderLine",
      "OPOLine",
      "TraceEdge",
      "MaterialLot",
      "ReconciliationStatement",
      "ErpSyncJob",
      "AgentRun",
    ]) {
      expect(PURGE_MODELS as readonly string[], m).toContain(m);
    }
  });

  it("删除顺序必须子表在前 —— 否则外键会挡住父表的删除", () => {
    const order = PURGE_MODELS as readonly string[];
    const before = (child: string, parent: string) => {
      expect(order.indexOf(child), `${child} 应排在 ${parent} 之前`).toBeLessThan(
        order.indexOf(parent),
      );
    };
    before("BOMLine", "BOMVersion");
    before("BOMVersion", "BOM");
    before("QuoteLine", "QuoteVersion");
    before("QuoteVersion", "Quote");
    before("PurchaseOrderLine", "PurchaseOrder");
    before("PriceBreak", "SupplierOffer");
    before("SupplierQuoteLine", "SupplierQuote");
    before("OPOReply", "OPOLine");
    before("TraceShipmentLine", "TraceShipment");
    before("ErpSyncJobLine", "ErpSyncJob");
    before("AgentStep", "AgentRun");
    before("ContainmentAction", "QualityIncident");
    before("RFQStatusHistory", "RFQ");
  });
});

describe("clientKey", () => {
  it("与 Prisma 的属性命名一致,且**每个模型都能在客户端上找到** —— 拼错就等于静默跳过一张表", () => {
    expect(clientKey("BOM")).toBe("bOM");
    expect(clientKey("RFQ")).toBe("rFQ");
    expect(clientKey("PurchaseOrder")).toBe("purchaseOrder");
    // 真实校验:所有待清理模型的 clientKey 都必须存在于 dmmf 的模型名映射里
    const known = new Set(ACTUAL_MODELS.map(clientKey));
    for (const m of PURGE_MODELS) expect(known, m).toContain(clientKey(m));
  });
});

describe("每张待清理的表都必须有 tenantId —— 否则 deleteMany 的租户隔离无从谈起", () => {
  it("PURGE 名单里没有缺 tenantId 的表", () => {
    const byName = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
    const missing = (PURGE_MODELS as readonly string[]).filter(
      (m) => !byName.get(m)?.fields.some((f) => f.name === "tenantId"),
    );
    expect(missing, `缺 tenantId 的表:${missing.join(", ")}`).toEqual([]);
  });
});
