# KICKOFF ROUND 2 — 产品化六 PR(F1–F6)开工指令

> 本文档基于 GPT 提出的六 PR 方案,经评审方(Claude)对照 CLAUDE.md、SPEC、INTEGRATION_PLAN 及前期架构决策修订而成。
> 与 GPT 原案的差异见"零、修订说明";其余原案要求全部保留并在各 PR 节内以【原案】标出要点、以【补充】标出新增要求。
> 使用方式:整份作为 Claude Code 的会话起始输入;先完成"七、审计报告",等人工确认后再逐 PR 执行。

仓库:gongyueetree/ezplm-smt-scm · 从最新 main(PR #59 之后)开始,不基于旧分支。

---

## 零、相对 GPT 原案的修订说明(评审方)

| # | 修订 | 原因 |
|---|---|---|
| 1 | **主数据真源按租户配置**,Kingdee 物料/库存同步必须经现有 Provider 抽象(泛化为 MasterDataProvider:EZPLM / KINGDEE / MOCK),禁止为 Kingdee 另起同步路径 | 原案 F4 把 Material/Inventory 纳入 Kingdee 同步,与融合钉子"ezPLM=物料/库存唯一真源、禁止双写"冲突;产品化后不同租户的真源不同,必须配置化 |
| 2 | **PR 顺序调整为 F5 → F1 → F4 → F3 → F2 → F6** | F5 是纯工程、零范围风险、直接对应客户已真实遭遇的 BOM 丢行/Gerber 卡死,应最先建立回归护栏,保护后续五个 PR 不回退;F2(新领域+最大 schema 增量)与 F6(客户可见安全面)放最后,留足确认窗口 |
| 3 | 三个高风险 PR 增加**检查点 A(设计/schema 先审后码)**:F2 ECN schema 与状态机、F3 Token 安全设计、F6-B 门户隔离边界 | 延续"schema 与安全边界最不能返工"的既有纪律 |
| 4 | F1 管理看板 KPI 建立**共享查询层**(lib/metrics),F6 品质看板与管理看板必须消费同一查询源 | 原案 F6 要求"禁止 Dashboard 单独算一套数字",但 F1 先做时若未抽共享层,F6 必然重复实现 |
| 5 | F4 保留并显式衔接**ERP 回写替代路径**(Excel 模板 → 中间表 → RPA → API) | 既有决策:ERP 回写永远提供兜底链;NOT_CONFIGURED 状态下客户仍应能走 Excel 导出,不得因引入同步状态机而回退 |
| 6 | F3 公开链路页与 F6 门户页必须遵守 **basePath 可配置 + APP_PUBLIC_URL 环境变量**,邮件中的链接不得硬编码域名 | 融合钉子(反代子路径)+ 国内独立域名部署 |
| 7 | 新增**CLAUDE.md 增补清单**(见"三、共同纪律"末尾),本轮沉淀的规则须写入常驻约束 | 防止跨会话遗忘 |
| 8 | 汇率/跨币种维持"保留并标注不可比、不引入硬编码汇率";Kingdee FX 同步仅建状态位,不落数值口径 | ERP 汇率口径属客户待答,不得臆断 |
| 9 | **引入 ERP 仿真环境 `gongyueetree/ezplm-erp-lab` 作为 F4/F3/F2 的联调目标**,其 `ErpProvider` 合约即本系统 ERP Provider 的对接契约(共享类型,禁止漂移) | 在不触碰客户真实金蝶的前提下形成业务闭环;Lab 已具备 Material/Inventory/Excess/Supplier/Customer/FX/Open PO 读取、幂等建 PO、ETA 更新与 13 种故障场景 |
| 10 | 新增 **LAB-1**(在 erp-lab 仓库):补 WorkOrder / SalesOrder 实体与 pull 接口 | ECN 影响分析、缺料/齐料页需要工单与未发货订单数据,Lab 当前没有 |
| 11 | 新增 **PR-F7 BOM 详情页增强**;F2 扩展为 ECN-Lite 核心 + 影响分析(Feature Flag);两者按 `PAGE_SPEC_BOM_DETAIL.md` / `PAGE_SPEC_ECN.md` 分层实施 | 客户测试版静态页(bom-detail/ecn-detail)中的信息与功能在系统中缺失;静态页混有二期内容,须分层而非照搬 |

---

## 一、核心原则(【原案】保留)

本轮只做"不依赖客户继续提供资料"的内容;不等待、不询问以下事项:金蝶 K3 云星空 API 文档与测试账号、Excess Report 样表、ERP 汇率口径、SMTP 密码/多账号规则、NRE 标准清单、DCC 人员定义与新料号编码规则、AR/AP 真实样表、客户实际失败 BOM/Gerber。这些属下一批真实联调。

严禁:编造金蝶 API / ERP 数据 / SMTP 发送成功 / SN/MES 数据 / NRE 标准项;写死客户内部料号规则;把 Mock 显示为已联调;因客户未回复而阻塞可先做的通用能力。

目标:从"乾创定制项目"改造为"可复制给多家 SMT/EMS/电子研发企业的标准化产品"。客户特有规则一律配置化。

【补充】产品化的技术底座 = 租户级配置(feature flag、主数据源、品牌 token、规则参数)。实施前先审计仓库是否已有 TenantSettings / feature-flag 机制,有则扩展,无则在 F1 建立一个,后续 PR 全部复用。

---

## 二、PR 顺序与检查点

```
F5   Golden Dataset Test Harness          ← 最先:回归护栏(ERP 夹具复用 Lab golden dataset)
F1   UX/Navigation Cleanup + 管理看板      (建立 lib/metrics 共享查询层)
F4   ERP Sync State + Retry + Audit       (ErpProvider 对接 ERP Lab 合约;Kingdee 经 Provider 抽象;保留 Excel 兜底链)
LAB-1 [erp-lab 仓库] WorkOrder / SalesOrder 扩展   ← 与 F4 并行,独立仓库独立 PR
F7   BOM 详情页增强                        (按 PAGE_SPEC_BOM_DETAIL.md 分层;库存/工单经 Provider)
F3   Supplier Confirmation Flow           ★检查点 A:Token 安全设计(ETA 确认→F4 回写状态)
F2   ECN-Lite + 影响分析                   ★检查点 A:schema + 状态机(按 PAGE_SPEC_ECN.md;影响分析依赖 F4+LAB-1)
F6   Quality Dashboard + Customer Portal  ★检查点 A:门户隔离边界(门户库存可用 Lab 的 customerCode 库存验证)
```

每个 PR 独立:建分支 → 实现 → 测试 → 自查 → 提交 → PR → CI 通过 → 合并 → 汇报 → **等人工确认**再开下一个。带★的 PR 先提交一页设计说明(检查点 A),确认后再写代码。审计报告中若有充分理由可建议再调顺序,但须说明依据。

---

## 三、共同工程纪律(【原案】保留 +【补充】)

【原案】tenant scoped、DataScope、RBAC、AuditLog、Prisma migration 向后兼容、金额 Decimal、AI 只建议不审批、外部 provider 未配置必须显式报错、不 silent drop、不因测试失败而 skip/放宽断言/硬编码结果/删测试、不改客户已确认规则、不重复实现已有能力(schema/routes/components/domain/repository/tests 先搜索,有则扩展)。

【原案】特别避免重复实现:PRE BOM/Production BOM、Purchase Request、GTB、Supplier Quote normalization、Quote Outcome、最小 Quality Event、SMTP Provider、Kingdee Provider 骨架;Phase2 静态 HTML 与 legacy-static 只作参考。

【补充】
- 所有公开(无登录)路由必须:排除在会话中间件之外但仍 tenant scoped(经 token 解析)、只允许 POST 改状态、限速、日志经 redactUrl 脱敏、遵守 basePath。
- 所有对外链接用 `APP_PUBLIC_URL` 拼装,禁止硬编码域名。
- 主数据读取一律经 MasterDataProvider(见 F4),业务代码不感知 EZPLM/KINGDEE/MOCK 差异。
- 跨币种:维持"保留并标注不可比",不引入硬编码汇率。

【补充·CLAUDE.md 增补】本轮结束前用 `#` 将以下规则写入 CLAUDE.md:
1. 主数据真源按租户配置(EZPLM/KINGDEE/NONE),本系统只读缓存,禁止双写;
2. 供应商协同状态严格区分 EMAIL_SENT / READ_RECEIPT_REQUESTED / READ_RECEIPT_RECEIVED / SUPPLIER_CONFIRMED,不可互相推导;
3. BOM 导入对账恒等式:业务行数 = recognized + needsMapping + needsReview + errors,生产代码路径必须产出可对账 ledger;
4. ERP 同步状态统一用 IntegrationSyncState,无凭据必须 NOT_CONFIGURED,禁止 return []/成功/假单号;
5. 客户门户服务端强制 customerId scope,内部/门户会话分域,门户用户不得进入内部搜索与 API;
6. 公开链路 token 只存 hash、有过期、防重放、tenant scoped、最小字段暴露。

---

## 四、测试门禁与文档同步(【原案】保留)

每 PR 至少运行:`pnpm lint` / `pnpm typecheck` / `pnpm db:validate` / `pnpm test` / `pnpm build` / `pnpm test:e2e`(脚本名以 package.json 为准)。**汇报必须附六项结果原文**:lint、typecheck、prisma validate、unit test 文件数与用例数、E2E passed/skipped/failed、build。外部凭据缺失导致无法运行的项标 BLOCKED_EXTERNAL,不得假装通过。

每 PR 同步更新 `docs/customer-feedback/PR2-FEEDBACK-TRACEABILITY.md`(DONE / PARTIAL / BLOCKED_EXTERNAL / DEFERRED),必要时更新 INTEGRATION_PLAN / SPEC / DEPLOYMENT / OPEN-QUESTIONS。不把本轮可做的项改写成"等客户",也不删除仍需客户回答的问题。

---

## 五、各 PR 要求

### F5 · Golden Dataset Test Harness(首个执行)
【原案】建立 `tests/fixtures/golden/`(bom/standard|nonstandard|large|edge-cases、gerber/small|large|malformed、supplier-quotes、shortage、ar-ap、excess),每 fixture 配 manifest(expectedInputRows/BusinessRows/Recognized/NeedsMapping/NeedsReview/Errors/mustBalance)。BOM 恒等式:业务行 = recognized + needsMapping + needsReview + errors,不得 silent drop;raw row ledger 可对账。合成 fixture 覆盖:中英文列头、MPN 别名、多 sheet、合并单元格、缺 MFG/MPN、重复位号、一格多 MPN、尾部空行、公式、异常日期、10k+ 行、>10MB。Gerber:小 zip、>10MB、接近上限、非法 zip、缺扩展名、未知层文件。大文件运行时生成/CI artifact,不入 git。`pnpm test:golden` 可单独跑。输出清晰 reconciliation;失败须指出哪一行、哪一阶段丢失。`tests/fixtures/customer/` gitignore,不放客户敏感文件。
【补充】
- 对账 ledger 必须由**生产导入管线**产出(不是测试里另算一遍),测试只断言;
- 合成生成器带固定随机种子,结果确定;为 CI 设时间预算,>10MB 用例可标 slow 单独触发;
- 用合成数据复现"12.4MB / 17000 行"等价场景,作为已修缺陷的永久回归用例;
- 后续 F1–F7 每个 PR 的 CI 都必须跑 golden 套件,任何一条不平衡即阻断合并;
- ERP 相关夹具复用 Lab 仓库 `tests/fixtures/erp/*/manifest.json`(normal / missing-fx / network-drop-after-commit)的格式与 golden dataset,避免两套夹具口径。

### F1 · UX/Navigation Cleanup + 管理看板
【原案】统一 PM/采购/工程/管理四工作台;左侧导航按角色与 permission 真正变化;全局搜索按 SEARCH_SCOPES(复用,不建第二套):ENGINEERING=BOM/ECN变更/物料,PROCUREMENT=供应商/采购RFQ/PO/OPO,PM=RFQ/客户/报价/BOM,MANAGEMENT=跨模块但仍 tenant/data scope;通用 PageHeader/Breadcrumb/BackButton;管理首页聚合 Quote Summary / True Quote Conversion / Gross Margin / Inventory / Excess / Shortage / Scrap-Loss / Quality Incidents;"报价总数"进 summary/list 不进单张报价;毛利取正式 Quote/Project Margin 源,不跳物料模拟器;Inventory/Excess 支持 customer/date/warehouse/status 组合筛选;KPI 可下钻并带过滤参数;风险 KPI 用 critical/warning/normal 语义样式;不改权限边界,URL 直达仍走服务端 RBAC。验收:四角色菜单与搜索确实变化、KPI 跳转正确、无死链、无重复导航、返回逻辑统一、tenant scope 不破坏。
【补充】
- 建立 `lib/metrics/`(或仓库既有等价目录)作为所有 KPI 的**唯一查询层**,每个 KPI 一个带 tenant/data scope 的查询函数,管理看板与 F6 品质看板共同消费;
- KPI 数据源尚不存在(如 Scrap/Loss 若无数据表)时显示明确 empty state 并标"数据源待接入",**禁止造数或用示例数**;
- 面包屑由统一 route config 派生(与左侧菜单同源),不得手写路径;
- 若仓库无租户级 feature-flag/settings 机制,在本 PR 建立(供 F6 门户开关等复用);
- 新增 Playwright:四角色切换菜单/搜索断言、至少 3 个 KPI 下钻断言、一条 URL 直达越权返回 403 断言。

### F4 · ERP Sync State + Retry + Audit
【原案】不做真实 Kingdee API,只做集成基础设施。统一 IntegrationSyncState(NOT_CONFIGURED/READY/PENDING/SYNCING/SYNCED/FAILED/RETRY_REQUIRED/BLOCKED)与 IntegrationSyncRecord(provider/entityType/entityId/direction/state/externalId/externalDocumentNo/时间戳/attemptCount/errorCode/errorMessage/sourceUpdatedAt/syncedSnapshot…);**已有 IntegrationJob 则扩展不复制**。应用到 Material、Inventory snapshot、Excess snapshot、FX rate、PO、ETA update、Supplier、Customer、AR/AP(预留)。页面显示真实状态(ERP 未配置 / 等待联调 / 同步失败·Retry / 已同步·Kingdee PO No);人工 Retry;lease/idempotency/唯一集成键防并发重复;所有 attempt 审计;ExternalEntityMapping(有等价模型则不新增);无凭据必须 NOT_CONFIGURED,禁止 return []/成功/假单号;Integration Status 管理页;为未来 Kingdee 提供清晰接入点。
【补充·架构关键】
- **主数据方向**:Material/Inventory/Excess 的读取必须经泛化后的 `MasterDataProvider`(把现有 EzplmPartsProvider 泛化或包一层,实现 Ezplm / Kingdee / Mock),由租户配置 `masterDataSource` 选择;Kingdee 只是一个实现,**不得另起独立同步路径**。单一真源原则不变:本系统对主数据只读缓存,禁止双写。
- **流程结果回写方向**(PO/ETA 等):经 IntegrationSyncRecord 管理状态,但 NOT_CONFIGURED 时必须仍可走既有 **ERP Excel 模板导出 → 回执登记** 兜底链,并在页面并列展示"API 待联调 / Excel 模板可用",不得因引入状态机而移除已有导出能力。
- FX rate 仅建同步状态位与占位记录,不落任何汇率数值与换算逻辑(客户口径待答)。
- 审计报告须列出现有 lease 机制、IntegrationJob 结构与 Kingdee Provider 骨架的具体文件,证明"扩展而非新建"。
【补充·ERP Lab 对接(本 PR 的联调目标)】
- Lab 合约(`src/lib/providers/erp/contracts.ts`):testConnection / pullMaterials / pullInventory / pullExcess / pullSuppliers / pullCustomers / pullExchangeRates / pullOpenPurchaseOrders / createPurchaseOrder(input, idempotencyKey) / updateEta。Lab 的 Canonical DTO(Decimal String、ErpInventory 含 warehouse/lotNo/customerCode、ErpPurchaseOrder 含 status/idempotencyKey)即本系统 ERP DTO;**将 contracts.ts + types.ts 抽为共享包或在本仓库镜像并加契约测试**,任何一侧改动都要跑对方的 contract test。
- 实现 `HttpErpProvider`(调用 Lab 的 `/api/erp`,动作名与上表一致;写操作携带 `ERP_LAB_ACCESS_TOKEN`),与既有 Kingdee 骨架并列为 ErpProvider 的实现;租户配置 `erpProvider = KINGDEE | ERP_LAB | NONE`。Lab 只是联调目标,**UI 中标注"ERP 仿真环境"而非"金蝶已联调"**。
- 用 Lab 的 13 种场景(AUTH_EXPIRED/RATE_LIMIT/TIMEOUT/PARTIAL_RESPONSE/DUPLICATE_PO/MATERIAL_NOT_FOUND/SUPPLIER_NOT_FOUND/FX_MISSING/PO_ALREADY_EXISTS/ERP_500/NETWORK_DROP_AFTER_COMMIT 等)作为 IntegrationSyncState 状态机的集成测试矩阵:每个场景对应一个期望终态(FAILED / RETRY_REQUIRED / BLOCKED / SYNCED)与审计记录;`NETWORK_DROP_AFTER_COMMIT` 必须验证同 idempotencyKey 重试拿回原单而不重复建 PO。
- 环境变量:`ERP_LAB_BASE_URL`、`ERP_LAB_ACCESS_TOKEN`(仅服务端)。

### F3 · Supplier Confirmation Flow ★检查点 A
【原案】邮件只是通知载体,业务状态由供应商明确确认。SupplierActionRequest(kind/supplierId/relatedEntity/tokenHash/expiresAt/status/respondedAt/respondedByName/Email/responsePayload);原始 token 不入库只存 hash、有 expiry、单次或状态防重放、tenant scoped、无登录只暴露最小字段。场景:PO Confirmation(Confirm / Confirm with changes / Cannot accept,含 confirmedQty/confirmedEta/supplierNote)、OPO ETA、Call Material、RFQ(复用既有 Supplier Offer 入口,不新建 quote 模型)。确认后:追加 Supplier Action Event、更新实体 supplier response state、审计、UI 标"Supplier Confirmed via Link"。状态严格区分 EMAIL_SENT / READ_RECEIPT_REQUESTED / READ_RECEIPT_RECEIVED / SUPPLIER_CONFIRMED,单测保证不可互推。SMTP 未配置时可生成链接与草稿,状态仍为 Draft/Not Sent,不伪造发送。
【补充】
- 检查点 A 先交付一页设计:token 生成/哈希算法、有效期、重放策略、公开路由清单与中间件排除方式、限速策略、日志脱敏点、最小字段清单;
- token 放 URL 路径而非查询串(降低日志/Referer 泄露),全链路 redactUrl;
- 公开页遵守 basePath,链接由 APP_PUBLIC_URL 拼装;
- 记录响应方 IP/UA 到 Event(审计用),但不作为身份凭据;
- OPO 确认落到既有 OPOReply(replySource=PORTAL 或新增 LINK 值),**不建平行回复表**;
- 与 F4 的 ETA 回写状态联动:供应商确认后仅标记"待回写 ERP",不自动触发同步。

### F2 · ECN-Lite ★检查点 A
【原案】不做高级影响分析/全链路联动/PLM 级 Change Order/PPAP/签章/切换算法。模型:Ecn、EcnChangeLine(多行,不限单物料)、EcnApproval、EcnAttachment(复用通用附件)。状态:DRAFT/REVIEW/CUSTOMER_CONFIRM/APPROVED/RELEASED/CLOSED/VOIDED。列表与组合筛选(status/type/priority/customer/date);KPI(Active/Awaiting Review/Customer Confirmation/Overdue/Released This Month)可下钻;XLSX/CSV 批量导入 Change Lines(不做 PDF/图片 AI 导入);Submit/Approve/Reject/Release/Void;VOIDED 可查可溯禁物理删除;Release 记录 approved snapshot + 影响 BOM/版本 + who/when;**不自动改正式 BOM**,生成新 BOM Version 须用户显式"Apply to BOM"并二次确认;导出含 Header/Change Lines/Approval history/Affected BOM/Notes;AuditLog 全覆盖;UI 注明"ECN-Lite / 当前版本支持登记、评审、审批、发布与 BOM 关联"。
【补充】
- 检查点 A 先交付 schema 草案 + 状态机转移表(含谁可触发、前置条件、审计动作),按既有 schema 纪律自查(tenant unique、Decimal、FK 策略"聚合内 FK/跨聚合标量"、快照 Json 理由);
- Release 快照与 Quote 快照同一模式(Json 冻结文档),Apply to BOM 生成的新 BOMVersion 必须回链 ecnId;
- ECN KPI 走 lib/metrics 共享层,供管理看板与工程工作台复用;
- 在 INTEGRATION_PLAN 记录:ECN-Lite 作为产品标准能力实施,范围以本节为界,完整 ECN 仍在待商务确认池;
- **页面与影响分析按 `docs/PAGE_SPEC_ECN.md` 实施**:T1 核心即本节;T2 影响分析(`ecn.impactAnalysis`)只读面板,数据经 ErpProvider(库存/批次/在途 PO/呆滞现可由 Lab 验证;工单/销售订单待 LAB-1),AI 建议不写入;T2 客户告知轻量版(`ecn.customerNotice`)经既有 OutboundMessage,SMTP 未配置停在草稿;T3(MES 指令/流程引擎/品质阶段/签章)占位;
- 评审阶段固定 ENGINEERING → PROCUREMENT → MANAGEMENT(可租户级启停阶段),**不得出现品质/总经理等五角色外身份**,"是否需品质评审"进待商务确认池;
- 检查点 A 的设计说明须同时覆盖影响分析面板的数据源矩阵与降级行为。

### LAB-1 · ERP Lab 扩展(在 `ezplm-erp-lab` 仓库,独立 PR,与 F4 并行)
目标:补齐 ECN 影响分析与缺料/齐料闭环所需的两个实体,保持 Lab 既有纪律(tenantId、DECIMAL、Canonical DTO、审计、场景注入)。
- 新增 `ErpWorkOrder`(externalId、woNumber、customerCode、productCode/bomRef、qty、status:PLANNED/IN_PROGRESS/COMPLETED/SHIPPED、currentOperation?、consumedLines[]:{materialCode, consumedQty}、plannedStart/End)与 `ErpSalesOrder`(externalId、soNumber、customerCode、lines[]:{productCode, qty, shippedQty, requestedDate}、status);
- 合约新增 `pullWorkOrders(input?)`、`pullSalesOrders(input?)`;API `/api/erp` 增加同名动作;数据维护工作台与快照导入支持两数据集;golden dataset 增加与现有物料/客户引用一致的样本(引用校验);
- 新增场景 `WORK_ORDER_SOURCE_UNAVAILABLE`(工单源不可用,其它源正常),供本系统验证"部分数据源失败"降级;
- 真实金蝶 Adapter 仍保持 `WAITING_FOR_DOCUMENTATION`,不猜测 endpoint;
- 门禁:npm test / test:erp / test:e2e / build 全绿,contract test 覆盖新方法。

### F7 · BOM 详情页增强(按 `docs/PAGE_SPEC_BOM_DETAIL.md`)
- T1:页面骨架与 KPI(走 lib/metrics)、物料明细 Tab(复用 BOMLine/BomMatchCandidate/BomLineDecision,批量确认带确认卡片可逐条取消)、版本列表与对比(复用既有 compare diff 函数)、替代关系只读、审批历史复用 AuditLog 时间线;
- T2(Feature Flag,默认关):版本演进图谱(`bom.versionGraph`,ECO 分支来自 ECN 回链)、制造工程信息只读四卡(`bom.manufacturingInfo`,模型 + 表单/XLSX 录入);
- T3 占位:Feeder Layout、AVL 规则引擎,注明待商务确认;
- 库存/工单列经 MasterDataProvider / ErpProvider,ERP 未配置显示"待接入",Lab 配置后显示真实值与更新时间;
- 禁止:示例数据、第二套匹配 UI、第二套 diff、Agent 编号式标签、MES/扫码/SN;
- 验收与 Playwright 见规格 §9。

### F6 · Quality Dashboard + Customer Portal Shell ★检查点 A(仅 B)
**A. Quality Dashboard**【原案】复用既有事件类型(INCOMING/PROCESS/CUSTOMER_COMPLAINT/SUPPLIER/TRACE_INCIDENT/OTHER)与 quality.* permission;KPI(Open/Investigating/Contained/Closed This Month/Customer Complaints/Supplier Issues);筛选(type/status/customer/supplier/date/severity/owner);30/90 天趋势(复用已有 chart lib);KPI 下钻;可选挂 lot/工单/发运/供应商/客户;**与管理看板同一查询源**;页面注明"最小品质事件管理,IQC/8D/CAPA/PPAP/RMA/SPC 属后续扩展"。
【补充】KPI 全部消费 F1 的 lib/metrics,本 PR 不得新写聚合 SQL;趋势按 tenant scope 且不含其他租户数据(E2E 断言)。

**B. Customer Portal Shell**【原案】客户只看自己库存进出;本 PR 只做 Shell + 安全边界,不猜最终字段。独立 route group `/portal`;服务端强制 customerId scope;页面 Overview/My Inventory/Transactions/Lots/Exports(无数据显示 empty state);绝对禁止暴露采购价/供应商/供应商报价/毛利/PPV/其他客户/内部备注/管理看板/采购备注;KPI 仅在有真实数据时计算;CSV 导出按 customer scope;账号仅内部 admin 邀请,无自注册;`CUSTOMER_PORTAL_ENABLED` 或租户 feature flag 控制,默认可关,但代码完整且 E2E 验证隔离。
【补充】
- 检查点 A 先交付隔离设计:门户与内部**独立认证域**(独立 cookie 名/secret/中间件),门户 session 不得被内部 API 接受、内部 session 不得访问 /portal 数据;禁止字段清单落到 DTO 层(白名单序列化),而非仅前端隐藏;
- 门户用户不进入 SEARCH_SCOPES 与任何内部搜索/列表 API;
- 遵守 basePath 与 APP_PUBLIC_URL;
- E2E 隔离矩阵作为合并门禁:客户 A 访问客户 B 数据→404/403;门户 session 调内部 API→401;内部 session 访问 /portal→401;导出文件不含禁止字段;
- 门户"我的库存/流水"可用 Lab 的 `ErpInventory.customerCode` 维度做真实数据验证(客户 A 只见 customerCode=A 的库存),但字段规则仍以客户最终确认为准。

---

## 六、汇报格式(每 PR)
1. 已完成 / 未完成 / DEFERRED / BLOCKED_EXTERNAL 清单;
2. 六项测试门禁结果原文(含用例数);golden 套件结果;
3. 新增/修改的 Prisma migration 名称与向后兼容说明;
4. 复用了哪些既有模块(证明未重复实现);
5. traceability 文档更新条目;
6. 明确区分"功能未做"与"功能已有但外部接口未联调"。

---

## 七、开工第一步:Immediate Work Audit(先审计,后编码)
【原案】输出:当前 main SHA;最近 10 个相关 PR/commit;六个 PR 各自的已有能力/可复用代码/缺失能力/预计文件/是否需 migration/scope 风险;重复实现风险;架构冲突;顺序建议。状态统一 DONE / PARTIAL / MISSING / BLOCKED_EXTERNAL / DEFERRED;严格区分"功能没做"与"已有但未联调"。
【补充】审计还须逐项回答:
- 是否已有租户级 feature-flag / settings 机制(文件位置);
- 现有 Provider 接口名与实现列表,泛化为 MasterDataProvider 的改动面;
- 现有 IntegrationJob / lease / Kingdee 骨架 / SMTP / OutboundMessage / 通用附件模型的文件位置;
- SEARCH_SCOPES 与 route config 的文件位置及是否存在第二套导航;
- 现有 chart lib;
- BOM 导入管线中 ledger 的现状(是否已可对账);
- 对修订后顺序(F5→F1→F4→LAB-1→F7→F3→F2→F6)的意见及依据;
- 现有 BOM 详情/对比页与 ECN 相关代码的现状(对照两份 PAGE_SPEC 逐节标 DONE/PARTIAL/MISSING);
- 现有 Kingdee Provider 骨架与 Lab `ErpProvider` 合约的方法/DTO 差异清单(决定"共享包"还是"镜像+契约测试")。

完成审计后停止,等人工确认再从 F5 开始。

> 附:`docs/PAGE_SPEC_BOM_DETAIL.md`、`docs/PAGE_SPEC_ECN.md` 与本文档同批放入仓库;两份静态页原件位于 `legacy-static/customer-demo/`,仅作参考。
