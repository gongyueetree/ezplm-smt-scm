/**
 * 演示环境重置的**表分类**(纯数据 + 校验函数)。
 *
 * 为什么把分类单独抽出来:清库脚本最危险的失败方式不是"删错了",
 * 而是**漏了一张表却没人知道** —— 客户看到一个"清理过"的系统里还挂着
 * 上一轮的报价单,或者反过来,一张本该保留的配置表被顺手删掉。
 *
 * 所以这里做两件事:
 * 1. 每一张业务表显式落进 PURGE 或 KEEP,**不允许沉默的第三类**;
 * 2. `verifyPlanCoverage()` 拿 Prisma 的实际模型清单来比对 ——
 *    将来新增一张表而忘了分类,脚本会直接报错拒跑,而不是默默留下它。
 *
 * 删除顺序按**依赖倒序**:子表先删、父表后删。这里不用 CASCADE 猜,
 * 显式排序比依赖数据库配置更可控,出问题也看得出是哪一步。
 */

/**
 * 要清空的表 —— 测试期产生的业务单据与运行记录。
 * **顺序即删除顺序**:先子后父。
 */
export const PURGE_MODELS = [
  // ---- AI Agent 运行记录 ----
  "AgentEvidence",
  "AgentApproval",
  "AgentStep",
  "AgentRun",

  // ---- 追溯与质量事件(子 → 父)----
  "ContainmentAction",
  "QualityIncident",
  // SN 记录来自 MES/离线导入,属业务数据;主数据侧不受影响
  "FinishedGoodsSerial",
  "TraceAnalysisRun",
  "TraceSubstitution",
  "TraceShipmentLine",
  "TraceShipment",
  "WorkOrderMaterialIssue",
  "TraceWorkOrder",
  "LotSplitMerge",
  "FinishedGoodsLot",
  "MaterialLot",
  "ReceiptLot",
  "TraceEdge",
  "TraceEvent",
  "TraceImportBatch",

  // ---- 对账 ----
  "ReconciliationLine",
  "ReconciliationStatement",

  // ---- 在途与催办 ----
  "ReminderLog",
  "OPOReply",
  "OPOLine",
  "PoAcknowledgement",

  // ---- 采购订单与申请 ----
  "PurchaseOrderApproval",
  "PurchaseOrderLine",
  "PurchaseOrder",
  "PurchaseRequest",

  // ---- 询价与报价(供应商侧)----
  "PriceBreak",
  "SupplierOffer",
  "SupplierQuoteLine",
  "SupplierQuote",
  "ProcurementRFQ",
  "AlternateSelection",

  // ---- 客户报价 ----
  // 分项任务随报价一起清:它挂在具体某张报价的某个版本上,留着就是孤儿
  "QuoteComponentTask",
  "QuoteBatchUpdateJob",
  "QuoteApproval",
  "QuoteLine",
  "QuoteVersion",
  "Quote",

  // ---- BOM ----
  // F7:制造工程信息挂在具体版本上,随 BOM 一起清(在 BOMVersion 之前删)
  "BomVersionManufacturingInfo",
  // 原始行去向随导入作业一起清(它是某次导入的逐行记录,不是主数据)
  "RawBomRow",
  "BomCompareRun",
  "BomLineDecision",
  "BomMatchCandidate",
  "BOMLine",
  "BOMVersion",
  "BOMImportJob",
  "BOM",

  // ---- RFQ ----
  "RFQStatusHistory",
  "RFQAttachment",
  "RFQ",

  // ---- 集成运行记录(**不含**连接与凭据配置)----
  "ErpSyncJobLine",
  "ErpSyncJob",
  "ErpConflict",
  "ErpWebhookEvent",
  "IntegrationJob",
  // F4:实体级同步状态是运行记录(某张 PO 回写到哪一步),不是配置 —— 清库重来
  "IntegrationSyncRecord",

  // ---- 缺料单与 Call 料(子 → 父)----
  // 缺料单是业务导入的单据,Call 料记录与其邮件草稿都是测试期产物;
  // 归 PURGE 后清库不会留下"上一轮客户的缺口还挂在处理台上"。
  "CallMaterialRecord",
  "ShortageSheetLine",
  "ShortageSheet",

  // ---- Excess 快照(导入的业务数据,子表在前)----
  // 归 PURGE 而非 KEEP:它是"某次导入的呆滞清单",属测试期产生的单据;
  // 主数据侧(Part/Customer)不受影响。
  "ExcessLine",
  "ExcessSnapshot",

  // ---- 外发邮件(子 → 父)----
  "MessageDeliveryEvent",
  "MessageAttachment",
  "MessageRecipient",
  "OutboundMessage",

  // ---- 其它测试期产物 ----
  "EmailDraft",
  "SupplierOnboardInvite",
  "ScrapRecord",
  "ApiUsageLog",
  "ExternalPartSnapshot", // 三方数据缓存,清掉会重新拉,不是主数据
] as const;

/**
 * 保留的表 —— 演示基线、主数据、配置与账号。
 *
 * 判断口径:**清掉之后系统还能不能立刻用来演示**。
 * 物料、供应商、客户、库存快照这些一清,客户打开就是一个空系统,
 * "清理"就变成了"废掉"。
 */
export const KEEP_MODELS = [
  // ---- 账号与权限(注册的新账号一并保留)----
  "Tenant",
  "User",
  "Role",
  "UserRole",
  "UserPermission",
  "PermissionGrant",

  // ---- 物料主数据及其附属 ----
  "Part",
  "PartAlternate",
  "PartAttributeDefinition",
  "PartAttributeValue",
  "PartCodeRule",
  "PartComplianceDeclaration",
  "PartComplianceEvidence",
  "PartCreationRecord",
  "PartDocument",
  "PartIdentifier",
  "PartProcessAttr",
  "PartSupplierRef",
  "PartTag",
  "PartTagLink",
  "CustomerPartMapping",

  // ---- 往来单位 ----
  "Supplier",
  "SupplierContact",
  "Customer",

  // ---- 演示用的库存/在途基线(来自 ERP 侧快照,不是本系统产生的单据)----
  "InventorySnapshot",
  "OpenPOLine",

  // ---- 配置与模板 ----
  // 租户配置/feature flag 属配置,清库保留
  "TenantSettings",
  "QuoteTemplate",
  // NRE 项目字典属**配置**(客户提供的标准清单),不是测试期单据 —— 清库保留
  "NreItemDefinition",
  // 汇率属**配置/主数据性质**(来自 ERP 或人工维护),清库保留
  "FxRate",
  "ProcurementPolicy",
  "ScrapExportTemplate",
  "ErpConnection",
  "ErpCredential",
  "ErpFieldMapping",
  "ErpSyncPolicy",

  /*
   * 审计日志默认保留。
   * 它是 append-only 的历史,清掉等于把"谁在什么时候做了什么"一并抹掉;
   * 而且清理动作本身也要写审计 —— 先删再写会让人误以为系统从没被用过。
   * 确实要清时用 --include-audit。
   */
  "AuditLog",
] as const;

export type PurgeModel = (typeof PURGE_MODELS)[number];

export interface CoverageResult {
  ok: boolean;
  /** Prisma 里有、但两张名单都没提到的表 —— 必须让脚本拒跑 */
  unclassified: string[];
  /** 名单里有、Prisma 里已不存在的表 —— 说明名单过期了 */
  stale: string[];
  /** 同时出现在两张名单里 —— 分类自相矛盾 */
  conflicting: string[];
}

/**
 * 用 Prisma 的实际模型清单校验分类是否穷尽。
 *
 * 新增一张表却忘了分类时,`unclassified` 非空 —— 脚本必须据此拒绝执行。
 * 这比"跑完才发现少删了一张"要早得多。
 */
export function verifyPlanCoverage(actualModels: readonly string[]): CoverageResult {
  const purge = new Set<string>(PURGE_MODELS);
  const keep = new Set<string>(KEEP_MODELS);
  const actual = new Set(actualModels);

  const conflicting = [...purge].filter((m) => keep.has(m)).sort();
  const unclassified = actualModels.filter((m) => !purge.has(m) && !keep.has(m)).sort();
  const stale = [...purge, ...keep].filter((m) => !actual.has(m)).sort();

  return {
    ok: conflicting.length === 0 && unclassified.length === 0 && stale.length === 0,
    unclassified,
    stale,
    conflicting,
  };
}

/** Prisma 客户端上的属性名(首字母小写,`BOM` → `bOM`,与 Prisma 生成规则一致) */
export function clientKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
