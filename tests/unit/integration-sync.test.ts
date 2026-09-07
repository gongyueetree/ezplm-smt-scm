/**
 * F4:实体级同步状态机。
 *
 * 核心是**ERP Lab 13 场景 → 终态矩阵**:每个故障场景对应一个明确终态
 * (SYNCED / RETRY_REQUIRED / FAILED / BLOCKED),以及
 * NETWORK_DROP_AFTER_COMMIT 的幂等重试序列 —— 重试必须复用原键、
 * 拿回原单、不重复建 PO。
 *
 * 如实说明:这里的"Lab 行为"是按 Lab 仓库 `simulator/index.ts` 的真实语义
 * 写的测试替身(错误码/retryable/提交后断网的先写后抛),验证的是**本系统
 * 状态机与重试逻辑**;对真实 Lab 部署的联调需配置 ERP_LAB_BASE_URL 后进行,
 * 本测试不冒充那件事。
 */
import { describe, expect, it } from "vitest";
import {
  applyFailure,
  applySuccess,
  buildIntegrationKey,
  canAttempt,
  canManualRetry,
  canTransition,
  classifyErpFailure,
  SYNC_STATE_LABEL,
  type IntegrationSyncState,
} from "@/lib/domain/integration-sync";
import { LAB_SCENARIO_CODES } from "@/lib/providers/erp/lab/contract";

describe("状态转移表", () => {
  it("SYNCED 只能从 SYNCING 进入 —— 不存在任何『直接标成功』的路径", () => {
    const states = Object.keys(SYNC_STATE_LABEL) as IntegrationSyncState[];
    for (const from of states) {
      if (from === "SYNCING") {
        expect(canTransition(from, "SYNCED")).toBe(true);
      } else {
        expect(canTransition(from, "SYNCED")).toBe(false);
      }
    }
  });

  it("SYNCING 不可再进 SYNCING(防重复抢占),终态们可回 SYNCING(重试)", () => {
    expect(canTransition("SYNCING", "SYNCING")).toBe(false);
    expect(canTransition("RETRY_REQUIRED", "SYNCING")).toBe(true);
    expect(canTransition("FAILED", "SYNCING")).toBe(true);
    expect(canTransition("BLOCKED", "SYNCING")).toBe(true);
  });

  it("NOT_CONFIGURED 只能去 READY(重新配置),不能直接开始同步", () => {
    expect(canTransition("NOT_CONFIGURED", "SYNCING")).toBe(false);
    expect(canTransition("NOT_CONFIGURED", "READY")).toBe(true);
  });

  it("人工重试只对 RETRY_REQUIRED / FAILED / BLOCKED 亮灯", () => {
    expect(canManualRetry("RETRY_REQUIRED")).toBe(true);
    expect(canManualRetry("FAILED")).toBe(true);
    expect(canManualRetry("BLOCKED")).toBe(true);
    expect(canManualRetry("SYNCED")).toBe(false);
    expect(canManualRetry("SYNCING")).toBe(false);
    expect(canManualRetry("NOT_CONFIGURED")).toBe(false);
    expect(canAttempt("SYNCING")).toBe(false);
  });
});

describe("ERP Lab 13 场景 → 终态矩阵", () => {
  it("场景清单与 Lab 合约一致(13 种,漂移即红)", () => {
    expect(LAB_SCENARIO_CODES).toHaveLength(13);
  });

  /**
   * 每行:场景 → Lab 实际抛出的错误码(见 Lab scenario-engine.ts / simulator)
   * → 我方终态。读取类场景(PARTIAL_RESPONSE/FX_MISSING/SLOW_ERP/NORMAL)
   * 不抛错,终态为 SYNCED,单列在下一个用例。
   */
  const FAILURE_MATRIX: [scenario: string, code: string, retryable: boolean, expected: string][] = [
    ["AUTH_EXPIRED", "ERP_AUTH_EXPIRED", false, "BLOCKED"],
    ["TIMEOUT", "ERP_TIMEOUT", true, "RETRY_REQUIRED"],
    ["RATE_LIMIT", "ERP_RATE_LIMITED", true, "RETRY_REQUIRED"],
    ["ERP_500", "ERP_INTERNAL_ERROR", true, "RETRY_REQUIRED"],
    ["DUPLICATE_PO", "PO_ALREADY_EXISTS", false, "BLOCKED"],
    ["PO_ALREADY_EXISTS", "PO_ALREADY_EXISTS", false, "BLOCKED"],
    ["MATERIAL_NOT_FOUND", "MATERIAL_NOT_FOUND", false, "FAILED"],
    ["SUPPLIER_NOT_FOUND", "SUPPLIER_NOT_FOUND", false, "FAILED"],
    ["NETWORK_DROP_AFTER_COMMIT", "NETWORK_DROP_AFTER_COMMIT", true, "RETRY_REQUIRED"],
  ];

  it.each(FAILURE_MATRIX)("%s(%s)→ %s", (_scenario, code, retryable, expected) => {
    const cls = classifyErpFailure({ code, retryable });
    expect(cls.state).toBe(expected);
    // 所有失败都必须复用原幂等键 —— 换键重试是最危险的操作
    expect(cls.mustReuseIdempotencyKey).toBe(true);
  });

  it("读取类场景(NORMAL/SLOW_ERP/PARTIAL_RESPONSE/FX_MISSING)不抛错 → SYNCED", () => {
    // 这四种场景 Lab 正常返回(部分响应/空集也是 200)。
    // PARTIAL_RESPONSE 客户端无法察觉少了行 —— 数据完整性由对账/重拉兜底,
    // 这里如实按成功处理并在快照记录行数,不假装能检测。
    const patch = applySuccess({ externalId: null, documentNumber: null });
    expect(patch.state).toBe("SYNCED");
    expect(patch.errorCode).toBeNull();
  });

  it("未知错误码不猜语义:retryable → RETRY_REQUIRED,否则 FAILED", () => {
    expect(classifyErpFailure({ code: "SOMETHING_NEW", retryable: true }).state).toBe("RETRY_REQUIRED");
    expect(classifyErpFailure({ code: "SOMETHING_NEW", retryable: false }).state).toBe("FAILED");
  });

  it("凭据类错误(ERP_LAB_UNAUTHORIZED)→ BLOCKED,重试不会自己好", () => {
    expect(classifyErpFailure({ code: "ERP_LAB_UNAUTHORIZED", retryable: false }).state).toBe("BLOCKED");
  });
});

describe("幂等键", () => {
  it("从业务身份推导,任何时刻再生成都一样(不含时间戳/随机数)", () => {
    const a = buildIntegrationKey({ tenantId: "t1", entityType: "PURCHASE_ORDER", entityId: "po-1" });
    const b = buildIntegrationKey({ tenantId: "t1", entityType: "PURCHASE_ORDER", entityId: "po-1" });
    expect(a).toBe(b);
    expect(a).toBe("t1:PURCHASE_ORDER:po-1");
  });

  it("不同对象/租户键必不同(串键=跨单幂等污染)", () => {
    const base = buildIntegrationKey({ tenantId: "t1", entityType: "PURCHASE_ORDER", entityId: "po-1" });
    expect(buildIntegrationKey({ tenantId: "t2", entityType: "PURCHASE_ORDER", entityId: "po-1" })).not.toBe(base);
    expect(buildIntegrationKey({ tenantId: "t1", entityType: "PURCHASE_ORDER", entityId: "po-2" })).not.toBe(base);
  });
});

describe("NETWORK_DROP_AFTER_COMMIT:幂等重试序列(Lab 语义测试替身)", () => {
  /** 按 Lab simulator 的真实行为造的替身:先落单、后抛错;同键重试返回原单 */
  function makeLabLikeErp() {
    const orders: { externalId: string; poNumber: string; idempotencyKey: string }[] = [];
    let dropNext = true;
    return {
      orders,
      async createPurchaseOrder(idempotencyKey: string) {
        const existing = orders.find((o) => o.idempotencyKey === idempotencyKey);
        if (existing) {
          return {
            success: true,
            externalId: existing.externalId,
            documentNumber: existing.poNumber,
            idempotentReplay: true,
          };
        }
        const po = {
          externalId: `SIM-PO-${String(orders.length + 1).padStart(5, "0")}`,
          poNumber: `SIM2026090700${orders.length + 1}`,
          idempotencyKey,
        };
        orders.push(po); // 先提交(Lab:PO 已写入)
        if (dropNext) {
          dropNext = false; // 再断网(响应丢失)
          throw Object.assign(new Error("PO 已在 ERP 提交,但网络在返回响应前断开"), {
            code: "NETWORK_DROP_AFTER_COMMIT",
            retryable: true,
          });
        }
        return { success: true, externalId: po.externalId, documentNumber: po.poNumber, idempotentReplay: false };
      },
    };
  }

  it("首试断网 → RETRY_REQUIRED;同键重试拿回原单;ERP 侧只有一张 PO", async () => {
    const erp = makeLabLikeErp();
    const key = buildIntegrationKey({ tenantId: "t1", entityType: "PURCHASE_ORDER", entityId: "po-9" });
    const seenKeys: string[] = [];

    // 第一次尝试:Lab 已建单但响应丢失
    let firstPatch;
    try {
      seenKeys.push(key);
      await erp.createPurchaseOrder(key);
      throw new Error("unreachable");
    } catch (e) {
      const err = e as { code: string; retryable: boolean; message: string };
      firstPatch = applyFailure({ code: err.code, retryable: err.retryable, message: err.message });
    }
    expect(firstPatch.state).toBe("RETRY_REQUIRED");
    expect(firstPatch.errorMessage).toContain("原幂等键");

    // 重试:**复用同一个键**(状态机纪律:键只生成一次)
    seenKeys.push(key);
    const result = await erp.createPurchaseOrder(key);
    const secondPatch = applySuccess(result);

    expect(secondPatch.state).toBe("SYNCED");
    expect(secondPatch.externalId).toBe("SIM-PO-00001"); // 拿回**首次创建**的单
    expect(secondPatch.note).toContain("幂等重放");
    expect(erp.orders).toHaveLength(1); // ERP 侧没有第二张 PO
    expect(new Set(seenKeys).size).toBe(1); // 两次请求键一致
  });

  it("反例:换了键重试会在 ERP 建出第二张单 —— 这正是禁止换键的原因", async () => {
    const erp = makeLabLikeErp();
    try {
      await erp.createPurchaseOrder("key-1");
    } catch {
      // 断网
    }
    await erp.createPurchaseOrder("key-2(错误做法:重试换键)");
    expect(erp.orders).toHaveLength(2); // 重复建单 —— 状态机必须防住这条路
  });
});
