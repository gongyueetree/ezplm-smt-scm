/**
 * R4-11:金蝶正式 API 骨架 —— 无文档一律 WAITING_FOR_DOCUMENTATION,禁止猜。
 */
import { describe, expect, it } from "vitest";
import { KingdeeApiNotDocumentedError, kingdeeApiAdapter } from "@/lib/integration/erp/sources/kingdee/api";

describe("Kingdee API Adapter 骨架", () => {
  it("status=WAITING_FOR_DOCUMENTATION;每个操作抛 NotDocumented(不猜 endpoint)", async () => {
    expect(kingdeeApiAdapter.status).toBe("WAITING_FOR_DOCUMENTATION");
    for (const op of ["pullMaterials", "pullMaterialMfgMappings", "pullInventory", "pullExcess", "pullCustomers", "pullSuppliers", "pullPurchaseOrders"] as const) {
      await expect(kingdeeApiAdapter[op]({}), op).rejects.toBeInstanceOf(KingdeeApiNotDocumentedError);
      await expect(kingdeeApiAdapter[op]({})).rejects.toMatchObject({ status: "WAITING_FOR_DOCUMENTATION" });
    }
  });
});
