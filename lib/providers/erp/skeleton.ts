/**
 * 未联调厂商的通用骨架(用友 / SAP / Oracle)。
 *
 * 为什么不直接不实现:接口必须齐全,业务代码才能一视同仁地调用;
 * 但**能力一律抛 ErpNotImplementedError**,绝不返回空数组冒充"同步完成 0 条"。
 * `testConnection` 也永远返回 ok=false,状态落到「待联调」。
 */
import {
  ErpNotImplementedError,
  type ConnectionTestResult,
  type ErpConnectionConfig,
  type ErpInventory,
  type ErpJobStatus,
  type ErpMaterial,
  type ErpMetadata,
  type ErpOpenPo,
  type ErpPage,
  type ErpProvider,
  type ErpPushResult,
  type ErpWorkOrder,
} from "./types";

export function createSkeletonProvider(
  vendor: string,
  entityFields: Record<string, string[]>,
  note: string,
): ErpProvider {
  const nope = (cap: string): never => {
    throw new ErpNotImplementedError(vendor, cap);
  };
  return {
    vendor,
    async testConnection(): Promise<ConnectionTestResult> {
      return {
        ok: false,
        responseMs: 0,
        erpVersion: null,
        organization: null,
        capabilities: [],
        failureReason: `${vendor} Adapter 尚未联调 —— 接口已定义,实现待客户环境就绪`,
        suggestion: note,
        testedAt: new Date().toISOString(),
      };
    },
    async getMetadata(config: ErpConnectionConfig): Promise<ErpMetadata> {
      return {
        vendor,
        edition: config.edition ?? null,
        entityFields,
        capabilities: [],
        notImplemented: Object.keys(entityFields),
      };
    },
    async pullMaterials(): Promise<ErpPage<ErpMaterial>> {
      return nope("pullMaterials");
    },
    async pushMaterials(): Promise<ErpPushResult> {
      return nope("pushMaterials");
    },
    async pullInventory(): Promise<ErpPage<ErpInventory>> {
      return nope("pullInventory");
    },
    async pullOpenPurchaseOrders(): Promise<ErpPage<ErpOpenPo>> {
      return nope("pullOpenPurchaseOrders");
    },
    async pullWorkOrders(): Promise<ErpPage<ErpWorkOrder>> {
      return nope("pullWorkOrders");
    },
    async pushPurchaseOrders(): Promise<ErpPushResult> {
      return nope("pushPurchaseOrders");
    },
    async pushEtaUpdates(): Promise<ErpPushResult> {
      return nope("pushEtaUpdates");
    },
    async getJobStatus(_c: ErpConnectionConfig, externalJobId: string): Promise<ErpJobStatus> {
      return { externalJobId, state: "UNKNOWN", message: `${vendor} 待联调` };
    },
  };
}
