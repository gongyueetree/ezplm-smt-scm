/**
 * KingdeeErpProvider —— **真实 Adapter 骨架**(金蝶 K3 / 云星空 / 星瀚)。
 *
 * 状态如实说明:签名、鉴权、分页、字段名都按金蝶 BOS 开放平台的形态写好了,
 * 但**未经真实环境联调**。没有凭据时:
 * - `testConnection` 直接返回 ok=false + 「待联调」原因与建议,**不发任何请求**;
 * - 各 pull/push 抛 ErpNotConfiguredError,而不是返回空数组冒充"没数据"。
 *
 * 联调需要客户在金蝶后台「BOS 集成开发平台」启用第三方应用接入并授权物料主数据相关 API。
 */
import {
  ErpNotConfiguredError,
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
  type ErpExcessLine,
  type ErpFxRate,
  type ErpOrganization,
} from "../types";

const REQUIRED_CONFIG = ["baseUrl", "dbId", "appId"] as const;
const REQUIRED_SECRETS = ["appSecret", "password"] as const;

function missingParts(config: ErpConnectionConfig): string[] {
  const miss: string[] = [];
  for (const k of REQUIRED_CONFIG) {
    if (!config.config?.[k] || String(config.config[k]).trim() === "") miss.push(k);
  }
  for (const k of REQUIRED_SECRETS) {
    if (!config.secrets?.[k]) miss.push(k);
  }
  return miss;
}

export class KingdeeErpProvider implements ErpProvider {
  readonly vendor = "KINGDEE";

  async testConnection(config: ErpConnectionConfig): Promise<ConnectionTestResult> {
    const missing = missingParts(config);
    const startedAt = Date.now();
    if (missing.length > 0) {
      return {
        ok: false,
        responseMs: 0,
        erpVersion: null,
        organization: null,
        capabilities: [],
        failureReason: `缺少必填项:${missing.join("、")}`,
        suggestion:
          "在连接配置中补齐数据中心地址、账套 ID、第三方应用 ID 与应用密钥;凭据由服务端加密保存,不会回传明文",
        testedAt: new Date().toISOString(),
      };
    }

    // 凭据齐备:发起真实登录请求。金蝶云星空的登录端点为 /Kingdee.BOS.WebApi.ServicesStub
    // .AuthService.ValidateUser.common.kdsvc,失败信息按其返回结构解析。
    const baseUrl = String(config.config.baseUrl).replace(/\/+$/, "");
    const url = `${baseUrl}/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parameters: [
            config.config.dbId,
            config.config.username ?? "",
            config.secrets.password,
            2052,
          ],
        }),
        signal: AbortSignal.timeout(Number(config.config.timeoutMs ?? 15000)),
      });
      const responseMs = Date.now() - startedAt;
      if (!res.ok) {
        return {
          ok: false,
          responseMs,
          erpVersion: null,
          organization: null,
          capabilities: [],
          failureReason: `HTTP ${res.status}`,
          suggestion: "检查数据中心地址是否可从本服务出网访问,以及第三方应用是否已授权",
          testedAt: new Date().toISOString(),
        };
      }
      const body = (await res.json().catch(() => null)) as
        | { LoginResultType?: number; Message?: string; Context?: { DBid?: string } }
        | null;
      const ok = body?.LoginResultType === 1;
      return {
        ok,
        responseMs,
        erpVersion: null, // 登录接口不返回版本;联调时改由 /GetSysVersion 取
        organization: body?.Context?.DBid ?? String(config.config.dbId),
        capabilities: ok ? ["pullMaterials", "pullInventory", "pullOpenPurchaseOrders"] : [],
        failureReason: ok ? null : (body?.Message ?? "登录被拒绝"),
        suggestion: ok
          ? null
          : "确认第三方应用已在 BOS 集成开发平台启用,且账号具备物料主数据 API 权限",
        testedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        ok: false,
        responseMs: Date.now() - startedAt,
        erpVersion: null,
        organization: null,
        capabilities: [],
        failureReason: e instanceof Error ? e.message : "请求失败",
        suggestion: "检查网络出口、超时设置与证书;若为内网 ERP,需要为本服务开通访问",
        testedAt: new Date().toISOString(),
      };
    }
  }

  async getMetadata(config: ErpConnectionConfig): Promise<ErpMetadata> {
    return {
      vendor: "KINGDEE",
      edition: config.edition ?? null,
      // 字段名取自金蝶物料/库存/采购订单标准表单,供映射页下拉;真实字段以客户账套为准
      entityFields: {
        MATERIAL: ["FNumber", "FName", "FSpecification", "FBaseUnitId", "FMinPurQty", "FPurBatchQty", "FLeadTime", "FDocumentStatus"],
        INVENTORY: ["FStockId", "FStockLocId", "FMaterialId", "FLot", "FBaseQty", "FLockQty", "FAvbQty", "FProduceDate"],
        OPEN_PO: ["FBillNo", "FSeq", "FSupplierId", "FMaterialId", "FQty", "FReceiveQty", "FRemainReceiveQty", "FDeliveryDate", "FPrice"],
        WORK_ORDER: ["FBillNo", "FMaterialId", "FBomId", "FQty", "FPlanStartDate", "FPlanFinishDate", "FStatus"],
      },
      capabilities: ["pullMaterials", "pullInventory", "pullOpenPurchaseOrders", "pullWorkOrders"],
      // 如实列出未联调项
      notImplemented: ["pushMaterials", "pushPurchaseOrders", "pushEtaUpdates"],
    };
  }

  private guard(config: ErpConnectionConfig): void {
    const missing = missingParts(config);
    if (missing.length > 0) throw new ErpNotConfiguredError("KINGDEE", missing);
  }

  async pullMaterials(config: ErpConnectionConfig): Promise<ErpPage<ErpMaterial>> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pullMaterials(骨架已就位,待真实账套联调)");
  }
  async pushMaterials(config: ErpConnectionConfig): Promise<ErpPushResult> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pushMaterials");
  }
  async pullInventory(config: ErpConnectionConfig): Promise<ErpPage<ErpInventory>> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pullInventory");
  }
  async pullOpenPurchaseOrders(config: ErpConnectionConfig): Promise<ErpPage<ErpOpenPo>> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pullOpenPurchaseOrders");
  }
  async pullWorkOrders(config: ErpConnectionConfig): Promise<ErpPage<ErpWorkOrder>> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pullWorkOrders");
  }
  async pushPurchaseOrders(config: ErpConnectionConfig): Promise<ErpPushResult> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pushPurchaseOrders");
  }
  async pushEtaUpdates(config: ErpConnectionConfig): Promise<ErpPushResult> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pushEtaUpdates");
  }
  /*
   * E8:客户已确认 ERP = 金蝶 K3 云星空,且 Excess 与汇率都在 ERP 里(Q1/Q8)。
   * 但**文档与测试账号尚未到位**(O1),Excess 字段样例(O2)与汇率有效日期口径(O3)
   * 也还没定。所以这三个方法与其它一样:骨架就位,调用即抛"待联调",
   * **绝不返回空数组冒充"查过了没有数据"** —— 那会让 PM 以为真的没有呆滞可用。
   */
  async getOrganizations(config: ErpConnectionConfig): Promise<ErpOrganization[]> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "getOrganizations(多组织账套列表,待真实账套联调)");
  }
  async pullExcessReport(config: ErpConnectionConfig): Promise<ErpPage<ErpExcessLine>> {
    this.guard(config);
    throw new ErpNotImplementedError(
      "KINGDEE",
      "pullExcessReport(客户 Q1 已确认走 ERP;待提供 Excess Report 字段样例 —— 见 OPEN-QUESTIONS O2)",
    );
  }
  async pullExchangeRates(config: ErpConnectionConfig): Promise<ErpPage<ErpFxRate>> {
    this.guard(config);
    throw new ErpNotImplementedError(
      "KINGDEE",
      "pullExchangeRates(客户 Q8 已确认走 ERP;待明确汇率类型与有效日期口径 —— 见 OPEN-QUESTIONS O3)",
    );
  }

  async getJobStatus(config: ErpConnectionConfig, externalJobId: string): Promise<ErpJobStatus> {
    this.guard(config);
    return { externalJobId, state: "UNKNOWN", message: "金蝶作业状态查询待联调" };
  }

  // ---- F4:Lab 合约增量。金蝶侧同样待凭据(OPEN-QUESTIONS O1),骨架不猜 endpoint ----
  async pullSuppliers(config: ErpConnectionConfig): Promise<never> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pullSuppliers(供应商档案,待真实账套联调)");
  }
  async pullCustomers(config: ErpConnectionConfig): Promise<never> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pullCustomers(客户档案,待真实账套联调)");
  }
  async createPurchaseOrder(config: ErpConnectionConfig): Promise<never> {
    this.guard(config);
    throw new ErpNotImplementedError(
      "KINGDEE",
      "createPurchaseOrder(API 直写建单待联调 —— 当前请走 Excel 模板兜底链)",
    );
  }
  async updateEta(config: ErpConnectionConfig): Promise<never> {
    this.guard(config);
    throw new ErpNotImplementedError(
      "KINGDEE",
      "updateEta(交期回写待联调 —— 当前请走 Excel 模板兜底链)",
    );
  }
  async pullSalesOrders(config: ErpConnectionConfig): Promise<never> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "pullSalesOrders(销售订单,待真实账套联调)");
  }
  async receivePurchaseOrder(config: ErpConnectionConfig): Promise<never> {
    this.guard(config);
    throw new ErpNotImplementedError("KINGDEE", "receivePurchaseOrder(收货回写待真实账套联调)");
  }
}
