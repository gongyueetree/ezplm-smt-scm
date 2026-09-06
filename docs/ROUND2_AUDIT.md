# ROUND 2 · Immediate Work Audit(开工前审计)

> 对应 `docs/KICKOFF_ROUND2.md` 第七节。审计基线:main `3d695e7`(#59 已合)。
> 结论先行:**同意修订后顺序 F5→F1→F4→LAB-1→F7→F3→F2→F6**,一条不改;
> 但有一个**必须在 F5 内一并修的 CI 陷阱**(见 0.3),否则后续文档类 PR 无法合并。

---

## 0. 全局事实

### 0.1 基线
- main SHA:`3d695e7`;分支保护已启用(必须 PR + `quality-gates` 通过,enforce_admins=true)。
- 最近 10 个已合 PR:#59 E9 客户三轮答复(15MB BOM 双缺陷修复)、#58 CI 减肥、#57 E2E 钉 Mock、#56 E8 金蝶契约+FX、#55 E7 SMTP、#54 E6 品质+SN-ready、#53 E5 对账引导、#52 E4 预BOM批量、#51 multipart 封顶、#50 E3 替代料批量。

### 0.2 KICKOFF 逐项追问的答案(文件位置)

| 追问 | 答案 |
|---|---|
| 租户级 feature-flag / settings | **MISSING**。`Tenant` 仅 id/name/slug/ezplmTenantId;全仓无 featureFlag/TenantSettings/masterDataSource。**F1 需新建**(建议 `TenantSettings` 单表 JSON+类型化读取层,供 F6/F7/F2 复用) |
| Provider 接口与实现 | `EzplmPartsProvider`(lib/providers/ezplm:mock/http 双实现,工厂 index.ts + PROVIDERS_FORCE_MOCK 开关);DigiKey/Mouser 同构;`ErpProvider`(lib/providers/erp/types.ts,实现:kingdee 骨架 / mock / excel / skeleton 工厂)。**泛化 MasterDataProvider 建议包一层而非改造** EzplmPartsProvider —— 它被 bom-match 管线(lib/domain/bom-match.ts)深度消费,改签名波及匹配全链 |
| IntegrationJob / lease / Kingdee 骨架 / SMTP / OutboundMessage / 通用附件 | `IntegrationJob`(schema,通用队列:idempotencyKey/attempts/nextRetryAt);**更丰富的是 `ErpSyncJob`**(lease:lockedBy/lockedAt/leaseExpiresAt、backoffStrategy、externalJobId、`@@unique(tenantId,idempotencyKey)`)+ 行级 `ErpSyncJobLine`(bizKey/outcome/erpValues/localValues/changedFields)+ `ErpConflict`/`ErpWebhookEvent`(`@@unique(tenantId,connectionId,externalId)` 即幂等实体键);lease 逻辑在 lib/server/repositories/erp-sync.ts(tests/unit/erp-job-lease.test.ts 在保)。Kingdee 骨架 lib/providers/erp/kingdee/index.ts(12 方法,无凭据抛 ErpNotConfiguredError)。SMTP lib/server/mail/index.ts + lib/domain/mail-receipt.ts;`OutboundMessage`+Recipient+**Attachment**+DeliveryEvent 四表已在。附件模型:RFQAttachment / PartDocument / MessageAttachment(**无跨域通用附件表**,F2 的 EcnAttachment 建议按聚合建表复用存储层 `FileStorageProvider`,而非造全局附件表) |
| SEARCH_SCOPES / route config / 第二套导航 | `SEARCH_SCOPES`+`WORKBENCH_*` 在 lib/rbac.ts;路由树唯一源 lib/routes.ts(`findRoute/parentPath` 已可派生面包屑);消费方仅 components/shell/topbar.tsx 与 app/(app)/page.tsx。**无第二套导航** ✓ |
| chart lib | **无任何图表库**。scrap 趋势(lib/domain/scrap-report.ts buildPeriodTrend)以表格渲染。F1/F6 的 30/90 天趋势:建议轻量内联 SVG(dataviz 纪律),**不引第三方大库** |
| BOM ledger 现状 | **DONE(E1a)**:生产管线产出 `RawBomRow` + `reconcileImport()`,恒等式 `totalRows = recognized + mergedIntoPrevious + nonBusiness + needsReview`,不平衡即 balanced=false 并 UI 报警;12.4MB/17000 行已有 E2E(zz-e9)。**与 KICKOFF 的公式词汇不同**(其 needsMapping/errors ≈ 我方 mergedIntoPrevious+withIssues/nonBusiness 分类),F5 应**断言现有类别**,不为对齐词汇而改生产语义 |
| redactUrl / APP_PUBLIC_URL | `redactUrl` 已有(lib/providers/common/errors.ts,全 Provider 在用);`APP_PUBLIC_URL` **MISSING**,F3 引入 |
| BOM 详情 / ECN 现状 | 无 `/bom/[bomId]` 详情路由(现有:台账 /bom、版本页 /bom/version/[id] 含匹配确认+转换、/bom/compare 复用 lib/domain/bom-compare.ts 的 diff)——对照 PAGE_SPEC_BOM_DETAIL:骨架/KPI/版本图谱/制造信息 MISSING,物料明细与对比 PARTIAL(能力在,但散在版本页,无统一详情壳)。ECN:**全仓零代码**(仅导航文案"ECN/BOM 变更记录"),整个 F2 为 MISSING |
| Kingdee 骨架 vs Lab 合约差异 | 见 §4 |

### 0.3 ⚠ 审计中发现的合并陷阱(F5 内必修)
#58 给 CI 加了 `paths-ignore: docs/**`,而分支保护要求 `quality-gates` 必过 ——
**纯文档 PR 不触发该检查,检查永远处于 expected 状态,PR 永久无法合并**。
本轮 KICKOFF/PAGE_SPEC/审计文档都是 docs-only,已经撞上。
修法(F5 一并做):增设同名 no-op 伴生 workflow,`paths` 恰为主 workflow 的 ignore 集,
使 docs-only PR 得到一个秒级通过的 `quality-gates`。这是 GitHub 官方建议做法。

---

## 1. 各 PR 摸底

### F5 Golden Dataset Harness —— 基础最好的一个
- 已有:E1a 行去向 ledger(生产管线)、zz-e9 大文件 E2E、bom-import-integrity 单测(13)、Gerber 上限/截断 E2E(e1b)、`extractRows` 多格式管线、固定种子无从谈起的问题不存在(合成器待建)。
- 缺失:`tests/fixtures/golden/` 目录与 manifest 机制、合成生成器、`pnpm test:golden` 脚本、CI 接线、>10MB slow 标记、Lab 夹具格式对齐。
- migration:无。scope 风险:低。**附带交付 0.3 的 CI 修复**。

### F1 UX/导航 + 管理看板
- 已有:四工作台骨架+快捷入口(lib/rbac.ts)、管理看板真实 KPI(lib/domain/management-kpi.ts + lib/server/repositories/management.ts + app/(app)/management-board.tsx,含订单转化率/审批通过率分离)、routes.ts 单源、RBAC/权限层。
- 缺失:`lib/metrics/` 共享查询层(现聚合散在 management.ts/各 repository)、全局搜索**实现**(SEARCH_SCOPES 只是配置,无搜索接口)、面包屑组件(parentPath 已有,组件未建)、TenantSettings/feature-flag、Gross Margin 与 Scrap/Loss KPI 接入、组合筛选(Inventory 已有 customer/date,warehouse/status 无字段——**warehouse 依赖 ERP 侧数据,先空态**)。
- migration:TenantSettings 一张表。scope 风险:中(搜索是新面;毛利口径须取 Quote 快照源,禁止跳物料模拟器——现有 approvedSnapshot.summary 可direct 取)。

### F4 ERP Sync State + Retry + Audit
- 已有(证明扩展不新建):ErpSyncJob 家族(lease/幂等/退避/行级 outcome)、ErpConnection/Credential/FieldMapping/SyncPolicy、ErpConflict、Excel 兜底链(lib/providers/erp/excel,PO 导出→回执登记)、Kingdee 12 方法骨架、E8 的 ErpExcessLine/ErpFxRate DTO、13 场景无——Lab 侧有。
- 缺失:统一 `IntegrationSyncState` 枚举(现 JobStatus 缺 NOT_CONFIGURED/READY/BLOCKED/RETRY_REQUIRED 语义)、**实体级**同步状态(ErpSyncJobLine 是"一次作业的行",不是"Material X 的当前状态"——需 IntegrationSyncRecord 或给实体加状态投影)、MasterDataProvider 泛化、HttpErpProvider(对 Lab)、租户 erpProvider/masterDataSource 配置(依赖 F1 的 TenantSettings)、Integration Status 管理页(现有 /settings/integrations/erp 可扩展)、场景×终态测试矩阵。
- migration:IntegrationSyncRecord + Tenant 配置字段。scope 风险:**本轮最高**之一;严守"包一层不改造"。

### LAB-1(ezplm-erp-lab 仓库)
- Lab 合约已取到(§4);WorkOrder/SalesOrder 全缺,按 KICKOFF 清单做。独立仓库独立门禁,与 F4 并行无冲突。

### F7 BOM 详情页
- 已有:BOMLine/MatchCandidate/Decision 全链、compare diff、PartAlternate 三维、AuditLog、转换面板、批量确认**无**(现在逐行)。
- 缺失:`/bom/[bomId]` 壳、KPI(走 metrics)、批量确认+确认卡片、版本图谱(BOMVersion 现无父子关系字段!——需 parentVersionId 或经 ecnId 回链,**schema 增量**)、BomVersionManufacturingInfo、阈值租户配置。
- 依赖:F1(metrics/flag)、F4(库存列经 Provider)。scope 风险:中。

### F3 Supplier Confirmation ★A
- 已有:OPOReply(replySource 字段在)、EmailDraft/OutboundMessage、redactUrl、middleware 豁免模式(api/upload 先例)、SupplierOffer 入口。
- 缺失:SupplierActionRequest(tokenHash/expiry/防重放)、公开路由组、限速(全仓无 rate limit 基建——设计需定方案:内存桶 per-token 足够)、APP_PUBLIC_URL。
- migration:SupplierActionRequest + SupplierActionEvent。scope 风险:高(安全面),检查点 A 先行正确。

### F2 ECN-Lite ★A
- 零基础,最大 schema 增量(Ecn/EcnChangeLine/EcnApproval/EcnAttachment + BOMVersion.ecnId 回链)。快照沿 Quote 模式、审批沿 PurchaseOrderApproval 模式、导入沿 alternate-bulk 模式、导出沿 compare-export 模式 —— 全部有母版可抄。影响分析依赖 F4+LAB-1。放倒数第二正确。

### F6 品质看板 + 门户 Shell ★A(B)
- 已有:QualityIncident(E6 全字段)+ quality.* 权限、管理看板;缺:趋势、metrics 消费、`/portal` 路由组、独立认证域(现单 cookie `scm_session`——需第二套 cookie/secret + 中间件分域)、DTO 白名单序列化层、CUSTOMER_PORTAL_ENABLED flag(依赖 F1)。
- scope 风险:高(隔离边界),放最后正确。

---

## 2. 重复实现风险清单(点名不许再造的)

行去向 ledger(E1a)、compare diff(bom-compare.ts)、快照冻结模式(quote.ts buildQuoteSnapshot)、审批表模式(QuoteApproval/PurchaseOrderApproval)、批量导入五步流(alternate-bulk)、导出框架(exceljs 各 export route)、lease/幂等(erp-sync.ts)、Excel 兜底链(erp/excel)、OutboundMessage/SMTP、OPOReply、PROVIDERS_FORCE_MOCK、redactUrl、AuditLog 时间线(/settings 审计页)。

## 3. 架构冲突点(已按 KICKOFF 修订消解,实施时盯住)

1. F4 若直改 EzplmPartsProvider 签名 → 波及 bom-match 全链。**包装层**。
2. IntegrationSyncState 若另起新表族而弃 ErpSyncJob → 双状态机。**扩展 ErpSyncJob + 新增实体级 Record,Job 引用 Record**。
3. F1 metrics 若从 management.ts 平移而不收编 quality/ecn 查询 → F6/F2 重复。**先定 metrics 接口再搬**。
4. 门户若复用 `scm_session` → 隔离失败。**独立 cookie+secret,middleware 按前缀分域**。

## 4. Kingdee 骨架 vs Lab `ErpProvider` 合约差异 → **建议:镜像 + 双向契约测试**(不建共享包)

| 维度 | 本系统 lib/providers/erp/types.ts | Lab contracts.ts |
|---|---|---|
| 配置 | 每方法传 `ErpConnectionConfig` | 实例化时配置,方法无 config |
| 返回 | `ErpPage<T>`(cursor 分页) | 裸数组 |
| Excess | `pullExcessReport` | `pullExcess` |
| PO 写入 | `pushPurchaseOrders(items[])` 批量 | `createPurchaseOrder(单, idempotencyKey)` |
| ETA | `pushEtaUpdates(items[])` | `updateEta(单)` |
| 独有(我方) | getMetadata / getOrganizations / getJobStatus / pullWorkOrders / pushMaterials | — |
| 独有(Lab) | — | pullSuppliers / pullCustomers |
| DTO | ErpInventory 无 customerCode(Lab 有,门户/Excess 归属要用) | Decimal String ✓ 双方一致 |

理由:两仓独立部署、发布节奏不同,共享 npm 包引入版本协调成本;差异是**适配器一层能吸收的**(HttpErpProvider 内做 单↔批、分页↔数组 转换)。在本仓镜像 Lab 的 types + 各自跑对方的 contract fixture(F5 已要求夹具口径对齐),漂移即红。**我方 DTO 需补 `ErpInventory.customerCode`(小 migration-free 类型改动)**。

## 5. 顺序意见

**同意 F5→F1→F4→LAB-1→F7→F3→F2→F6,无修改建议。** 补充两点执行细节:
- F5 兼修 0.3 的 CI 陷阱(否则本审计文档自己都合不进去);
- LAB-1 可在 F4 检查点期间穿插(不同仓库,互不阻塞)。

---

*审计到此为止。按 KICKOFF 约定:等人工确认后,从 F5 开工。*
