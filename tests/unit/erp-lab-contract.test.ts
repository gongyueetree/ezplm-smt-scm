/**
 * F4:ERP Lab 合约镜像的契约测试。
 *
 * 镜像(lib/providers/erp/lab/contract.ts)是逐字段照抄 Lab 仓库的
 * `src/lib/providers/erp/types.ts` —— 本文件用 Lab 侧真实形状的样本锁住它:
 * 任何一侧改字段名/必填性/Decimal 约定,这里先红,而不是运行时静默丢数据。
 *
 * 样本值取自 Lab 仓库 seed 与 README 的示例形状(不是编的业务数据,
 * 是**合约形状**的最小实例)。
 */
import { describe, expect, it } from "vitest";
import {
  DecimalStringSchema,
  LabSalesOrderSchema,
  LabWorkOrderSchema,
  LAB_OPERATIONS,
  LAB_SCENARIO_CODES,
  LabConnectionResultSchema,
  LabCustomerSchema,
  LabEnvelopeSchema,
  LabEtaUpdateSchema,
  LabExcessSchema,
  LabExchangeRateSchema,
  LabInventorySchema,
  LabMaterialSchema,
  LabPurchaseOrderSchema,
  LabSupplierSchema,
  LabWriteResultSchema,
} from "@/lib/providers/erp/lab/contract";

describe("操作名与场景码(与 Lab api/erp.ts、scenario-engine.ts 对齐)", () => {
  it("12 个 RPC 操作名逐字锁定(LAB-1 增加工单/销售订单)", () => {
    expect(LAB_OPERATIONS).toEqual([
      "testConnection",
      "pullMaterials",
      "pullInventory",
      "pullExcess",
      "pullSuppliers",
      "pullCustomers",
      "pullExchangeRates",
      "pullOpenPurchaseOrders",
      "pullWorkOrders",
      "pullSalesOrders",
      "createPurchaseOrder",
      "updateEta",
    ]);
  });

  it("14 个场景码逐字锁定(LAB-1 增加工单源不可用)", () => {
    expect([...LAB_SCENARIO_CODES].sort()).toEqual(
      [
        "NORMAL",
        "SLOW_ERP",
        "AUTH_EXPIRED",
        "TIMEOUT",
        "RATE_LIMIT",
        "PARTIAL_RESPONSE",
        "DUPLICATE_PO",
        "MATERIAL_NOT_FOUND",
        "SUPPLIER_NOT_FOUND",
        "FX_MISSING",
        "PO_ALREADY_EXISTS",
        "ERP_500",
        "NETWORK_DROP_AFTER_COMMIT",
        "WORK_ORDER_SOURCE_UNAVAILABLE",
      ].sort(),
    );
  });
});

describe("Decimal String 纪律", () => {
  it("接受整数/小数/负数字符串,拒绝浮点噪声与非数", () => {
    expect(DecimalStringSchema.safeParse("1200").success).toBe(true);
    expect(DecimalStringSchema.safeParse("0.125").success).toBe(true);
    expect(DecimalStringSchema.safeParse("-3.5").success).toBe(true);
    expect(DecimalStringSchema.safeParse("1e5").success).toBe(false);
    expect(DecimalStringSchema.safeParse("1,200").success).toBe(false);
    expect(DecimalStringSchema.safeParse("abc").success).toBe(false);
    expect(DecimalStringSchema.safeParse("").success).toBe(false);
  });
});

describe("DTO 形状(Lab 侧真实样本)", () => {
  it("ErpMaterial:externalId + materialCode 必填,其余可缺省", () => {
    expect(
      LabMaterialSchema.safeParse({ externalId: "MAT-001", materialCode: "QC-IC-0001", mpn: "STM32F103C8T6" })
        .success,
    ).toBe(true);
    expect(LabMaterialSchema.safeParse({ materialCode: "QC-IC-0001" }).success).toBe(false);
  });

  it("ErpInventory:含 customerCode(客户门户切库存的依据)与 Decimal onHandQty", () => {
    const ok = LabInventorySchema.safeParse({
      externalId: "INV-001",
      materialCode: "QC-IC-0001",
      warehouseCode: "WH01",
      customerCode: "CUST-LC",
      onHandQty: "854",
      availableQty: "800",
      lotNo: "LOT-1",
    });
    expect(ok.success).toBe(true);
    expect(
      LabInventorySchema.safeParse({ externalId: "x", materialCode: "y", onHandQty: 854 }).success,
    ).toBe(false); // number 不是 Decimal String
  });

  it("ErpExcess:bookQty 与 availableQty 都必填(账面≠可用是业务底线)", () => {
    expect(
      LabExcessSchema.safeParse({
        externalId: "EX-1",
        materialCode: "QC-RC-0104",
        bookQty: "5000",
        availableQty: "3200",
        earliestInboundAt: "2025-11-02",
      }).success,
    ).toBe(true);
    expect(
      LabExcessSchema.safeParse({ externalId: "EX-1", materialCode: "QC-RC-0104", bookQty: "5000" }).success,
    ).toBe(false);
  });

  it("ErpSupplier / ErpCustomer:code + name 必填", () => {
    expect(
      LabSupplierSchema.safeParse({ externalId: "S-1", supplierCode: "SUP-A", name: "供应商A", currency: "CNY" })
        .success,
    ).toBe(true);
    expect(LabCustomerSchema.safeParse({ externalId: "C-1", customerCode: "CU-A", name: "客户A" }).success).toBe(
      true,
    );
    expect(LabSupplierSchema.safeParse({ externalId: "S-1", supplierCode: "SUP-A" }).success).toBe(false);
  });

  it("ErpExchangeRate:rate 是 Decimal String,effectiveDate/source 必填", () => {
    expect(
      LabExchangeRateSchema.safeParse({
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.1850",
        rateType: "SPOT",
        effectiveDate: "2026-09-01",
        source: "KINGDEE_SIM",
      }).success,
    ).toBe(true);
  });

  it("ErpPurchaseOrder:行内 qty/unitPrice 为 Decimal String;status 只认三值", () => {
    const po = {
      supplierCode: "SUP-A",
      currency: "CNY",
      orderDate: "2026-09-07",
      status: "OPEN",
      lines: [{ lineNo: 1, materialCode: "QC-IC-0001", qty: "1000", unitPrice: "7.10" }],
    };
    expect(LabPurchaseOrderSchema.safeParse(po).success).toBe(true);
    expect(LabPurchaseOrderSchema.safeParse({ ...po, status: "SHIPPED" }).success).toBe(false);
  });

  it("ErpEtaUpdate / ErpWriteResult / ErpConnectionResult 形状", () => {
    expect(
      LabEtaUpdateSchema.safeParse({ poNumber: "SIM20260907001", lineNo: 1, eta: "2026-10-01" }).success,
    ).toBe(true);
    expect(
      LabWriteResultSchema.safeParse({
        success: true,
        externalId: "SIM-PO-00001",
        documentNumber: "SIM20260907001",
        idempotentReplay: true,
        message: "返回首次创建的采购单",
      }).success,
    ).toBe(true);
    expect(
      LabConnectionResultSchema.safeParse({
        connected: true,
        provider: "simulator",
        message: "Simulator ready",
        checkedAt: "2026-09-07T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("LAB-1:工单与销售订单形状(consumedLines/lines 嵌套,Decimal String)", () => {
    expect(
      LabWorkOrderSchema.safeParse({
        externalId: "WO-EXT-001",
        woNumber: "WO-2841",
        customerCode: "CUS-ACME",
        productCode: "FG-ACME-CTRL-A1",
        qty: "300",
        status: "COMPLETED",
        consumedLines: [{ materialCode: "EZ-STM32H743", consumedQty: "300" }],
      }).success,
    ).toBe(true);
    // status 只认四值
    expect(
      LabWorkOrderSchema.safeParse({
        externalId: "x", woNumber: "y", productCode: "z", qty: "1", status: "CANCELLED", consumedLines: [],
      }).success,
    ).toBe(false);
    expect(
      LabSalesOrderSchema.safeParse({
        externalId: "SO-EXT-001",
        soNumber: "SO20260810001",
        customerCode: "CUS-ACME",
        lines: [{ lineNo: 1, productCode: "FG-ACME-CTRL-A1", qty: "300", shippedQty: "200" }],
      }).success,
    ).toBe(true);
  });

  it("API 信封:ok:true 带 data;ok:false 带 error{code,retryable}", () => {
    expect(LabEnvelopeSchema.safeParse({ ok: true, data: [] }).success).toBe(true);
    expect(
      LabEnvelopeSchema.safeParse({
        ok: false,
        error: { code: "ERP_RATE_LIMITED", message: "限流", retryable: true },
      }).success,
    ).toBe(true);
    expect(LabEnvelopeSchema.safeParse({ ok: "yes" }).success).toBe(false);
  });
});
