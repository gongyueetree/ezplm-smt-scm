# Schema 落库基线(SPEC §4 · 43 模型)

> **状态:BASELINE(2026-07-27 评审确认)**
>
> - 旧 NestJS V15 schema 经人工确认**不可得**,旧表侧正式作废;本文件由"合并对照表"
>   转为 **PR2 落库执行核对表**,SPEC §4 的 43 个模型为唯一 schema 基线。
> - 决策与影响已记录于 `docs/INTEGRATION_PLAN.md` 末尾"计划偏差记录"。
> - 实现文件:`prisma/schema.prisma`(Prisma 7;连接串在 `prisma.config.ts`,env `DATABASE_URL`)。
>
> **全局纪律**(评审要求二.1–二.3):所有业务表带 `tenantId`;唯一约束一律
> tenant-scoped(`@@unique([tenantId, ...])`,无全局业务 unique);高频查询建
> `(tenantId, ...)` 复合索引;金额/单价/费率/数量一律 `Decimal`(禁 Float),币种独立字段;
> `Tenant.ezplmTenantId` / `User.externalUserId` 可空融合字段到位。

## 枚举清单(18 个)

| 枚举 | 取值 | 依据 |
|---|---|---|
| RoleName | PM / PROCUREMENT / ENGINEERING / MANAGEMENT / SUPPLIER(仅此五值) | SPEC §3;评审二.8 |
| RfqStatus | DRAFT / RECEIVED / PARSING / WAITING_ENGINEERING / WAITING_PROCUREMENT / QUOTING / PENDING_APPROVAL / QUOTED / CLOSED_NO_QUOTE / LOST | SPEC §5 |
| QuoteStatus | DRAFT / PENDING_APPROVAL / APPROVED / REJECTED / EXPIRED | CLAUDE.md 状态机;评审二.4 |
| QuoteCostCategory | MATERIAL / LABOR / NRE / SMT / DIP / TEST / OVERHEAD / OTHER | SPEC §12 |
| AttachmentType | BOM / GERBER / PDF / IMAGE / PROCESS_DOC / OTHER | SPEC §5 |
| JobStatus | PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED | 批处理状态机(评审二.9) |
| Lifecycle | ACTIVE / NRND / EOL / OBSOLETE / UNKNOWN | SPEC §6 |
| ProviderType | EZPLM / DIGIKEY / MOUSER / OFFLINE | SPEC §7–§10 |
| MatchSource | CUSTOMER_MAPPING / INTERNAL_PN / EXACT_MPN / MFR_MPN / DESCRIPTION / EZPLM / DIGIKEY / MOUSER / MANUAL | SPEC §6 匹配顺序 |
| LineDecisionType | ACCEPT_CANDIDATE / MANUAL_ASSIGN / NO_MATCH | 人工确认闭环 |
| ApprovalDecision | PENDING / APPROVED / REJECTED | 审批/确认卡片 |
| ProcurementRfqStatus | DRAFT / SOURCING / FEEDBACK_READY / CLOSED | SPEC §11 |
| SourcingMode | SPOT / FUTURES | SPEC §11 现货/期货 |
| FlagResolution | ACCEPT / REQUOTE / SWITCH_SOURCE / ADJUST_PRICE | CLAUDE.md 异常闭环 |
| PurchaseRequestStatus | DRAFT / SUBMITTED / PROCESSING / CLOSED | 整合方案 3.2 |
| ReplySource | EMAIL / PORTAL / EXCEL / PHONE / MANUAL | SPEC §14 |
| AgentType | RFQ_INTAKE / BOM_MATCHING / SOURCING / QUOTE / OPO | SPEC §13 |
| IntegrationJobType | ERP_ORDER_EXPORT / ERP_ETA_WRITEBACK / EMAIL_SEND / OPO_REMINDER / OTHER | SPEC §14 |

## 落库核对表(43 模型)

### 1. 租户与主体(7)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 1 | Tenant | 租户 | slug(全局唯一)、**ezplmTenantId?**(融合) | — |
| 2 | User | 用户(本地账号;只停用不删) | email、passwordHash?、**externalUserId?**(SSO)、isActive | `@@unique([tenantId, email])` |
| 3 | Role | 角色目录 | name | RoleName 五值;`@@unique([tenantId, name])` |
| 4 | UserRole | 用户-角色 | userId、roleId | `@@unique([tenantId, userId, roleId])` |
| 5 | Customer | 客户 | code、name、联系方式 | `@@unique([tenantId, code])` |
| 6 | Supplier | 供应商 | code、defaultCurrency、**priority**(rankOffers 因子) | `@@unique([tenantId, code])` |
| 7 | SupplierContact | 供应商联系人(邮件建档回填) | name、email、isPrimary | — |

### 2. RFQ 域(3)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 8 | RFQ | 客户询价 | code、customerId、quoteQtys(Json 阶梯数量)、dueAt、closedReason(不报价关闭) | RfqStatus 十态;`@@unique([tenantId, code])` |
| 9 | RFQAttachment | 附件(保留原始客户文件) | type、fileName、fileKey(FileStorageProvider)、uploadedById | AttachmentType |
| 10 | RFQStatusHistory | 状态流转处理记录 | fromStatus?、toStatus、changedById | RfqStatus |

### 3. BOM 域(4)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 11 | BOM | BOM 主体(RFQ 可关联多个) | rfqId?、name | — |
| 12 | BOMVersion | 版本(比对基础) | versionNo、sourceFileKey(原始文件) | `@@unique([tenantId, bomId, versionNo])` |
| 13 | BOMLine | 行(qty=Decimal) | refDes、qty、customerPn/mpn/manufacturer/footprint、dupRefDesFlag/eolFlag/footprintMismatch(导入校验事实) | `@@unique([tenantId, bomVersionId, lineNo])` |
| 14 | BOMImportJob | 大 BOM 分批导入(>50 MPN) | **idempotencyKey**、status、totalLines/processedLines/batchSize、columnMapping | JobStatus;`@@unique([tenantId, idempotencyKey])` |

### 4. 物料域(9,ezPLM 只读缓存语义)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 15 | Part | 物料主数据镜像(**只读缓存**,注释声明禁双写) | internalPn、mpn、lifecycle、dateCode/msl/packaging(客户需求字段)、sourcedFrom、syncedAt | Lifecycle;`@@unique([tenantId, internalPn])` |
| 16 | PartIdentifier | 多标识索引 | type、value | `@@unique([tenantId, type, value, partId])` |
| 17 | CustomerPartMapping | 客户料号映射(匹配第 1 位) | customerId、customerPn、partId? | `@@unique([tenantId, customerId, customerPn])` |
| 18 | PartAlternate | 替代关系 | partId、alternatePartId、grade | `@@unique([tenantId, partId, alternatePartId])` |
| 19 | InventorySnapshot | 库存快照(含呆滞) | qtyOnHand、qtySlowMoving、fetchedAt | Decimal(18,4) |
| 20 | OpenPOLine | 在途(GTB 扣减项) | poNo、qtyOpen、eta、fetchedAt | — |
| 21 | BomMatchCandidate | 匹配候选(SPEC §6 展示字段全落列) | source、confidence、stockQty/slowMovingQty/opoQty/eta/price、**dataUpdatedAt**(诚实 UI) | MatchSource、Lifecycle |
| 22 | BomLineDecision | 行级人工确认(每行至多一个) | candidateId?、decision、decidedById | LineDecisionType;`@@unique([tenantId, bomLineId])` |
| 23 | ExternalPartSnapshot | 外部 API 缓存 | source、cacheKey、payload、**fetchedAt/ttlSeconds**、expiresAt(物化,唯一写入通道派生) | ProviderType;`@@unique([tenantId, source, cacheKey])` |

### 5. 报价供应域(2)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 24 | SupplierOffer | NormalizedOffer 持久化(SPEC §10 全字段) | provider、mpn、stock/moq/spq、leadTimeDays、currency、sourceUpdatedAt/sourceUrl | ProviderType、Lifecycle |
| 25 | PriceBreak | 价格阶梯 | minQty、unitPrice Decimal(18,6) | `@@unique([tenantId, supplierOfferId, minQty])` |

### 6. 报价域(4)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 26 | Quote | 报价单标识(状态在版本上,当前版查询派生) | code、rfqId、customerId | `@@unique([tenantId, code])` |
| 27 | QuoteVersion | 修订版(快照=Json,理由见 schema 注释) | **revision** 递增、status、**submittedSnapshot/approvedSnapshot Json**、laborRateTemplate、rejectedReason | QuoteStatus;`@@unique([tenantId, quoteId, revision])` |
| 28 | QuoteLine | 报价行(SPEC §12 全字段) | category、quotedMfg/quotedMpn、altMfg/altMpn、materialCategory、purchaseCost/markupPct/finalUnitPrice/customerPrice/**ppv**(全 Decimal) | QuoteCostCategory |
| 29 | QuoteApproval | 审批记录(审批人限五角色,应用层校验) | approverId、decision、comment | ApprovalDecision |

### 7. 采购 RFQ 域(4)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 30 | ProcurementRFQ | 采购比价流程 | code、bomVersionIds(Json 多 BOM)、sourcingMode、feedbackNote(反馈 PM) | ProcurementRfqStatus、SourcingMode |
| 31 | SupplierQuote | 一次供应商报价 | supplierId、provider、currency、sourceFileKey(线下 Excel 原件)、quotedAt | ProviderType |
| 32 | SupplierQuoteLine | 报价行(异常闭环载体) | unitPrice/currency/moq/spq/leadTimeDays/quotedAt、**wasFlagged**(原始异常固化)、flagReasons、resolution?(默认空人工选)、**previousLineId**(换货源链,旧行不改写)、selected/selectionReason | FlagResolution、SourcingMode |
| 33 | PurchaseRequest | PM 采购申请单 | qty(GTB 输出)、**gtbSnapshot**(核算过程) | PurchaseRequestStatus;`@@unique([tenantId, code])` |

### 8. OPO 域(3)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 34 | OPOLine | 行级唯一数据源(KPI/差异/异常全派生,**无冗余计数字段**) | poNo/lineNo、qtyOrdered/qtyOpen、promiseDate/needDate、**nextReminderAt**(催办游标)、erpRef | `@@unique([tenantId, poNo, lineNo])` |
| 35 | OPOReply | 供应商回复 | **replyEta/replyQty/replyNote/replyAt/replySource** 五字段齐备 | ReplySource |
| 36 | ReminderLog | 催办日志 | **idempotencyKey**(防重发)、channel、status、sentAt | JobStatus;`@@unique([tenantId, idempotencyKey])` |

### 9. 智能体域(4)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 37 | AgentRun | 一次智能体运行(SPEC §13 全要素) | agentType、status、**idempotencyKey**、input/output、writtenRefs、error、**tokenUsage**、startedAt/finishedAt | AgentType、JobStatus |
| 38 | AgentStep | 步骤明细 | stepNo、toolName、input/output、status | `@@unique([tenantId, agentRunId, stepNo])` |
| 39 | AgentEvidence | 外部数据证据 | source、uri、payload、fetchedAt | ProviderType |
| 40 | AgentApproval | 写工具确认卡片 | toolName、payload(拟写入内容)、status、decidedById | ApprovalDecision |

### 10. 平台域(3)

| # | 模型 | 用途 | 关键字段 | 关键枚举/约束 |
|---|---|---|---|---|
| 41 | AuditLog | 审计(每写必录) | **tenantId/userId/action/entityType/entityId/before/after/createdAt** 全字段(评审二.7) | 三组复合索引 |
| 42 | IntegrationJob | 集成作业重试(ERP Excel 兜底) | type、**idempotencyKey**、payload、attempts、nextRetryAt | IntegrationJobType、JobStatus |
| 43 | ApiUsageLog | API 用量(X-RateLimit 观测) | provider、endpoint、rateLimitLimit/rateLimitRemaining、durationMs | ProviderType |

## 设计决策备忘(评审可复核)

1. **快照选 Json 而非再归一化表**(评审二.4 允许二选一):快照是冻结文档,整单 Json
   固化保证逐字节不漂移、不受后续行结构迁移影响;可编辑数据仍在 QuoteLine。
   Revision 递增靠 `@@unique([tenantId, quoteId, revision])`,"禁止覆盖已批准版本"由
   应用层只 INSERT 新修订 + 单测保障(检查点 B 起实现)。
2. **业务表 tenantId/userId 为受控标量,不建 FK**:租户隔离由应用层 tenant scope +
   复合唯一约束保证;审计/Agent 记录须比 User 行长寿(用户只停用不删),故不设用户 FK。
   域内导航关系(RFQ→附件、BOM→版本→行、报价→版本→行等)保留 FK。
3. **ExternalPartSnapshot.expiresAt 物化**:派生自 fetchedAt+ttlSeconds,由唯一写入
   通道计算,物化仅为过期清理/命中判断的索引效率(评审二.5 一致性保障方式说明)。
4. **OPO 无任何物化计数**:KPI/未回复/差异/异常全部查询派生(评审二.5)。
5. **Prisma 7**:连接串按 Prisma 7 规范移至 `prisma.config.ts`(env `DATABASE_URL`);
   版本固定 7.9.0(npmmirror 已同步版本,保障国内镜像可安装——生产部署在国内主机)。
