/**
 * F4:MasterDataProvider —— 主数据读取的**唯一入口**(KICKOFF Round2 决策 1)。
 *
 * 背景:融合钉子规定「ezPLM = 物料主数据唯一真源」,但产品化后不同租户的
 * 真源不同(乾创将来可能以金蝶为主数据源)。所以把"从哪读主数据"做成
 * 租户配置(`TenantSettings.masterDataSource`),业务代码经本工厂拿 Provider,
 * **不感知 EZPLM / KINGDEE / MOCK 差异,更不为金蝶另起同步路径**。
 *
 * 接口就是既有的 `EzplmPartsProvider` —— 它本来就是"主数据读取面"
 * (检索/逐 MPN/批量解析/库存/客户对照/替代/合规/参数/文档),泛化只需换名。
 * 单一真源纪律不变:无论哪个来源,本系统对主数据**只读 + 快照缓存,禁止双写**。
 *
 * KINGDEE 分支现状(如实):金蝶物料主数据 API 待客户凭据(O1),
 * 该分支抛 MasterDataNotConfiguredError,页面显示「主数据源待联调」——
 * 不回落到 ezPLM(那会静默换真源),也不返回空集(那会读成"没有这颗料")。
 */
import { getEzplmPartsProvider, ezplmProviderMode } from "@/lib/providers/ezplm";
import { HttpErpLabProvider, resolveErpLabEnv } from "@/lib/providers/erp/lab";
import { createErpLabMasterDataAdapter } from "./erp-lab-adapter";
import type { EzplmPartsProvider } from "@/lib/providers/ezplm";
import { getTenantSettings } from "@/lib/server/tenant-settings";

/** 主数据读取面 = 既有 ezPLM Provider 接口(泛化别名,不另造第二套) */
export type MasterDataProvider = EzplmPartsProvider;

export type MasterDataSource = "EZPLM" | "KINGDEE" | "ERP_LAB" | "NONE";

export class MasterDataNotConfiguredError extends Error {
  constructor(
    readonly source: MasterDataSource,
    detail: string,
  ) {
    super(`主数据源「${source}」不可用:${detail}`);
    this.name = "MasterDataNotConfiguredError";
  }
}

function notConfigured(source: MasterDataSource, detail: string): MasterDataProvider {
  // async:接口是 Promise 形态,拒绝也要以 rejected Promise 交付(同步 throw 会绕过调用方的 .catch)
  const nope = async (): Promise<never> => {
    throw new MasterDataNotConfiguredError(source, detail);
  };
  return {
    searchParts: nope,
    getPartByMpn: nope,
    batchResolve: nope,
    getInventory: nope,
    getCustomerMappings: nope,
    getAlternates: nope,
    getCompliance: nope,
    getParameters: nope,
    searchPartsWithParameters: nope,
    getDocuments: nope,
  };
}

/**
 * 按租户配置解析主数据 Provider。
 *
 * 调用方拿到的永远是同一接口;来源差异只体现在:
 * - EZPLM → 既有 ezPLM 工厂(内部再按环境变量分 Mock/Http);
 * - KINGDEE → 待联调占位(抛 MasterDataNotConfiguredError,绝不静默回落);
 * - NONE → 本系统自管主数据,无外部真源可查(同样抛错,让页面如实说明)。
 */
export async function getMasterDataProvider(tenantId: string): Promise<MasterDataProvider> {
  const { settings } = await getTenantSettings(tenantId);
  return providerForSource(settings.masterDataSource, settings.erpLabTenantId);
}

/** 纯函数分支(单测用;getMasterDataProvider 是它的带配置读取版) */
export function providerForSource(source: MasterDataSource, erpLabTenantId?: string | null): MasterDataProvider {
  switch (source) {
    case "EZPLM":
      return getEzplmPartsProvider();
    case "ERP_LAB": {
      // closed-loop P0-6:测试专用 —— env 未配置时抛 NotConfigured(不静默回落)
      const env = resolveErpLabEnv(erpLabTenantId);
      if (!env) {
        return notConfigured("ERP_LAB", "缺少 ERP_LAB_BASE_URL / ERP_LAB_ACCESS_TOKEN 环境变量");
      }
      return createErpLabMasterDataAdapter(new HttpErpLabProvider(env));
    }
    case "KINGDEE":
      return notConfigured(
        "KINGDEE",
        "金蝶物料主数据 API 待客户凭据与联调(OPEN-QUESTIONS O1)—— 不回落 ezPLM,不返回空集",
      );
    case "NONE":
      return notConfigured("NONE", "该租户未配置外部主数据源 —— 主数据仅存在于本系统");
  }
}

/** 供 UI 诚实展示当前主数据形态(如「ezPLM · Mock」);禁止暗示已联调 */
export async function masterDataMode(tenantId: string): Promise<{ source: MasterDataSource; mode: string }> {
  const { settings } = await getTenantSettings(tenantId);
  if (settings.masterDataSource === "EZPLM") {
    return { source: "EZPLM", mode: ezplmProviderMode() };
  }
  if (settings.masterDataSource === "ERP_LAB") {
    // UI 显示「ERP 仿真主数据」—— 绝不显示为金蝶/正式已连接
    return { source: "ERP_LAB", mode: resolveErpLabEnv(settings.erpLabTenantId) ? "http" : "not_configured" };
  }
  return { source: settings.masterDataSource, mode: "not_configured" };
}
