# ARCHITECTURE AUDIT — REF-0

> 基线:`main` @ `9de0409`(Merge PR #86)。分支 `docs/ref-0-architecture-audit`。
> **REF-0 只审计,不改一行生产代码、不动 schema、不删文件、不改 UI。**
> 所有结论以该 SHA 的实际代码为证据,不引用文档记忆。与文档冲突时以代码为准。
>
> 配套文件:[DUPLICATION_MATRIX.md](DUPLICATION_MATRIX.md) · [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) ·
> [REFACTOR_BACKLOG.md](REFACTOR_BACKLOG.md) · [MIGRATION_PLAN.md](MIGRATION_PLAN.md) ·
> [DEPRECATION_CANDIDATES.md](DEPRECATION_CANDIDATES.md)

---

## Executive Summary

**这个仓库的问题不是"写得烂",而是"同一条规则被写了 N 遍,然后各自漂移"。**

四轮迭代(PR1–9 → Round2 F1–F7 → Round3 R3-1–8 → R4 v2)每一轮都守住了自己的纪律
(诚实 UI、快照冻结、租户隔离、否定式护栏、三值 UNKNOWN),**这些纪律的执行质量很高,不要重写**。
代价出在**横向**:每一轮都在自己的模块里重新实现了归一、列映射、评分、结果对象,
四轮下来同一能力有 3–7 份实现,彼此规则不同、无人对账。

审计确认了 **4 个 P0 级正确性缺陷**,全部是"重复实现漂移"的直接产物,**全部当前在线**:

| # | 缺陷 | 后果 | 证据 |
|---|---|---|---|
| **P0-1** | MFG 映射写入用 CJK 保留键,BOM 匹配查询用 ASCII 键 | **521 条真实乾创映射永久查不出来**,静默无提示 | [bom-import.ts:273](../../lib/server/repositories/bom-import.ts) vs [part-mfg.ts:22](../../lib/domain/part-mfg.ts) |
| **P0-2** | 参数比较**只比数值不比量纲** | `72 MHz` 与 `72 MB` 判为"一致" | [param-compare.ts:171-187](../../lib/domain/param-compare.ts) |
| **P0-3** | 替代料候选只填 `package` 一项参数 | LOCAL/DIGIKEY 候选的技术分**恒等于封装分**,其余参数恒"缺失" | [alternate-search.ts:141-153](../../lib/server/repositories/alternate-search.ts) |
| **P0-4** | Agent 审批写入会把未提供的字段**全部置 null** | 批准一条 AI 分类建议 → 抹掉该行 `qty`/`purchaseCost`/`customerPrice`/MPN/备注 | [agent-approvals/[approvalId]/route.ts:45-50](../../app/api/agent-approvals/[approvalId]/route.ts) → [quote.ts:216-236](../../lib/server/repositories/quote.ts) |

另有 **2 个安全/纪律级问题**:`assertTenantScopedMutation` 在生产路径**零调用**(§11.3);
Agent 运行与审批两个端点**无任何角色守卫**(§4.4)。

> **2026-09-17 增补 P0-5**:客户对前期版本 BOM2BUY 的测试反馈到达后,逐条核实本仓库,
> 发现**零价格守卫在 4 条路径中只有 1 条生效**,且存了 `0.000000` 能通过报价提交完整性门禁 ——
> 客户截图里"`$0.0000` 计入合计"的缺陷经"线下 offer 导入"路径在本仓库同样会发生。
> 详见 [CUSTOMER_FEEDBACK_2026-09-17.md §0.4](CUSTOMER_FEEDBACK_2026-09-17.md),backlog 项 R0-8。
> 同一份反馈另增 4 项 P1 与 2 项 P2,并把 **P0-1 升为最高优先级**(客户要求匹配率 95+%)。

规模底数:生产代码 **76,810 行**(app 32,203 / lib 41,411 / components 1,062 / scripts 2,134),
测试 **26,244 行**,`schema.prisma` **4,232 行 / 125 model / 80 enum / 57 migration**。

---

## 1. 当前 bounded context

代码里**没有**显式的 bounded context 边界 —— 只有 `lib/domain`(83 文件,16,132 行)与
`lib/server/repositories`(38 文件,12,730 行)两个按**技术角色**而非按**业务域**切分的大筐。
按实际聚合关系反推,存在 11 个事实上的上下文:

| Context | 域模型(Prisma) | 域逻辑 | 仓储 | 页面 |
|---|---|---|---|---|
| **BOM** | BOM/BOMVersion/BOMLine/RawBomRow/BOMImportJob/BomCompareRun/BomMatchCandidate/BomLineDecision/BomVersionManufacturingInfo | bom-parse/match/validate/compare/ledger/detail/purpose、kicad-*、sexpr | bom-import(642)/bom-detail(289)/bom-ledger(127)/bom-convert(237) | /bom/** |
| **Parts 主数据** | Part/PartIdentifier/PartMfgMapping/CanonicalManufacturerRef/ManufacturerAlias/PartAttribute*/PartDocument/PartCompliance*/PartCodeRule/PartTag* | part-mfg/part-spec/part-category/part-code-rule/part-create/part-lifecycle/compliance-declaration | part-create(520)/part-detail(578)/part-mfg-mapping(176)/manufacturer-review(225) | /materials/** |
| **Alternates** | PartAlternate/AlternateSelection | alternate-score/rank/compat/bulk、param-compare、similarity | alternate-search(313)/alternate-selection(160) | /materials/alternates |
| **Sourcing / 采购比价** | SupplierOffer/PriceBreak/ProcurementRFQ/SupplierQuote(Line)/ProcurementPolicy/PartSupplierRef | sourcing/offers/price-pool/supplier-strategy/procurement-flags/supplier-offer-import/supplier-quote-parse/compare-summary | procurement(452)/rfq-supplier(280)/price-pool(264)/cost-matrix(302)/supplier-strategy(300) | /procurement/** |
| **RFQ(客户)** | RFQ/RFQAttachment/RFQStatusHistory | rfq-status/rfq-excel | rfq(232) | /rfq/** |
| **Quote** | Quote/QuoteVersion/QuoteLine/QuoteApproval/QuoteTemplate/NreItemDefinition/QuoteComponentTask/QuoteBatchUpdateJob/BomCostSelection | quote-calc/status/margin/outcome/tasks/template、gtb | quote(632)/quote-from-bom(81)/quote-nre(96)/quote-batch-update(161) | /quotes/** |
| **PO / OPO 履约** | PurchaseRequest/PurchaseOrder(Line)(Approval)/OPOLine/OPOReply/ReminderLog/PoAcknowledgement/ShortageSheet/CallMaterialRecord | opo/po-status/po-scheduling/po-price-review/po-bulk-input/shortage-sheet/kitting | purchase-order(627)/purchase-request(185)/opo(258)/kitting(98) | /procurement/orders、/suppliers/opo、/shortage |
| **ERP 集成** | ErpConnection/Credential/FieldMapping/SyncPolicy/SyncJob(Line)/Conflict/WebhookEvent/IntegrationJob/IntegrationSyncRecord/ErpUatImportBatch/InventorySnapshot/ExcessSnapshot(Line)/OpenPOLine/FxRate | erp-sync/erp-health/erp-retry/integration-sync + **`lib/integration/erp/**`(独立的三层适配器,R4 新建)** | erp-sync(859)/erp-connection(259)/integration-sync(404)/integration-worker(200)/uat-import(465) | /settings/integrations/** |
| **Traceability / 质量** | TraceImportBatch/ReceiptLot/MaterialLot/TraceWorkOrder/…/TraceAnalysisRun/QualityIncident/ContainmentAction | trace-graph/coverage/import/scope/uom、scrap-report | traceability(**991,全仓最大**)/ecn-impact(196) | /traceability、/quality、/scrap |
| **ECN** | Ecn/EcnChangeLine/EcnApproval/EcnCustomerNotice | ecn | ecn(524) | /ecn/** |
| **平台**(认证/租户/审计/门户/协同/对账) | Tenant/User/Role/UserRole/TenantSettings/AuditLog/PortalAccount/PortalInvite/SupplierActionRequest/OutboundMessage 族/RateLimitBucket/ApiUsageLog/Agent* /Reconciliation* | portal-invite/supplier-action/mail-receipt/email-draft/recon-*/data-scope/search-scopes/tenant-settings/demo-reset-plan | supplier-action(726)/reconciliation(434)/permission-admin(166)/agent-run(126) | /settings/**、/portal/**、/reconciliation |

**观察**:`lib/integration/erp/`(R4 v2 新建)是**全仓唯一已经按目标架构分层**的部分
(`profiles/` → `sources/kingdee/excel/` → `canonical/` → `normalization/`),
且 `canonical/types.ts` 的 DTO 边界清晰。它是 REF-1+ 的样板,不是要拆的对象。

---

## 2. UI → API → application → repository → Prisma 调用链

**目标形态**(规范里的):`page.tsx` 组合 → Route Handler 解析 → use case 编排 → repository 落库 → Prisma。
**实际形态**:三层经常被压成一层,且**每一层都能直连 Prisma**。

### 2.1 三条代表性链路(逐跳 file:line)

**(a) BOM 导入 —— 最长、最健康的一条**

```
app/(app)/bom/import/wizard.tsx:97      fetch POST /api/bom/import
  └ app/api/bom/import/route.ts (203行)  getStorageProvider:38 → extractRows:63
      → 域:reconcileImport:139,186 / countUniqueMpns:174 / shouldUseImportJob:187
      → lib/server/repositories/bom-import.ts:82 createImportJob
          → 幂等探针 prisma.bOMImportJob.findFirst:101
          → validateWithMasterData:49(prisma.part.findMany:58 → 域 validateBomLines:64)
          → $transaction:128 → tx.bOM/bOMVersion/bOMLine.createMany / rawBomRow.createMany:194
分批匹配:app/api/bom/import/[jobId]/route.ts:17 processNextBatch
  → bom-import.ts:406 → buildMatchContext:269(Prisma ×5 + 三个 Provider)
  → 域 matchBomLines:458 → $transaction:462
行决策:app/api/bom/lines/[lineId]/decision/route.ts:4 → bom-import.ts:529 saveLineDecision
  → tx.bOMLine.update:596  ← where 只有 { id },无 tenant 谓词
回读:app/(app)/bom/version/[versionId]/page.tsx:27 getBomVersionDetail
  ＋ 同一页面自己再查 prisma.customer.findMany:33          ← 分层破口
```

**(b) 采购 RFQ 比价 —— use case 直接住在 Route Handler 里**

```
app/(app)/procurement/rfq/[id]/sourcing-panel.tsx:112  fetch GET …/sourcing?offset=
  └ app/api/procurement/rfq/[id]/sourcing/route.ts (107行)  ← 编排逻辑在这里
      :33  自己 prisma.supplierQuoteLine.findMany
      :41  nextBatchSlice 分批
      :47-95 逐行 fan-out 循环 → runSourcing:49 → 线下报价归一 :52-73 → buildComparisonSet:75
      :97-103 进度装配
  repository procurement.ts:131 runSourcing 只做 Provider fan-out(无 Prisma)
  域 sourcing.ts buildComparisonSet(类型依赖 @/lib/providers/common/normalized-offer)
比价导出另起一条,完全不经 repository:
  app/api/procurement/rfq/[id]/compare-export/route.ts  Prisma ×4(:27,33,41,55)+ XLSX 双重循环
```

**(c) 报价审批 —— 三条里唯一端到端符合目标分层的**

```
app/(app)/quotes/[versionId]/editor.tsx:195  fetch POST …/decision
  └ app/api/quotes/[versionId]/decision/route.ts (33行)  zod:19 → decideQuoteApproval:22 → 状态映射:29
      └ quote.ts:475  getQuoteVersion:481 → 域 checkQuoteTransition:484
          → summarizeQuote:492 → buildQuoteSnapshot:497
          → $transaction:511,每个写操作都带 tenantWhere:513
旁路(绕开 repository 自己写):
  app/api/quotes/[versionId]/valid-until/route.ts:42-46  自己 $transaction + tx.quoteVersion.update
  app/api/quotes/[versionId]/outcome/route.ts            Prisma ×4
```

### 2.2 结构性结论

| 断言 | 数据 |
|---|---|
| Route Handler **不是**薄层 | 153 个路由中 **58 个直连 Prisma**,**12 个**含非平凡算法/编排体 |
| repository **不是**纯数据访问 | 38 个中约 18 个是"伪装成 repository 的 use case",8 个混合了数据/流程/第三方 |
| 页面**不是**只做组合 | 57 个 page/layout 中 **34 个直连 Prisma**(59.6%),其中 **18 个完全不经 repository** |
| 缺失的层 | **application / use case 层不存在**。业务编排落在 route handler 或 repository,取决于当初谁先写 |

---

## 3. 所有直接 Prisma 调用位置

Prisma 以单例懒代理导出:[lib/server/db.ts:38](../../lib/server/db.ts)。
**150 个文件**导入它。

| 桶 | 数量 | 占该类总数 |
|---|---|---|
| (a) `page.tsx` / `layout.tsx` 服务端组件 | **34** | 34 / 57 = 59.6% |
| (b) `app/api/**/route.ts` | **59** | 59 / 153 = 38.6% |
| (c) `lib/server/repositories/` | **37** | 37 / 38(仅 `management.ts` 无) |
| (d) `lib/server/` 其它 | 5 | data-scope、permissions、portal、rate-limit、tenant-settings |
| (e) `scripts/` | 3(经 `@/lib/server/db`)+ 3(自建 `new PrismaClient`) | reset-demo-data:44、reset-password:51、check-login:33 |
| (f) `tests/` | 3 | |
| (g) **`lib/metrics/`** | **8** | 未申报的第二数据访问层,被页面直接调用 |

### (a) 页面直连 Prisma —— 完全不经 repository 的 18 个

`bom/compare`(3 处调用)、`bom/import`(1)、`bom/imports/[jobId]`(2)、`bom/imports`(2)、
`ecn`(2)、**`inventory`(8 —— 页面级最大)**、`materials/compliance`(2)、`materials`(6)、
`procurement/rfq`(3)、`quality`(5)、`quotes`(3)、`rfq`(2)、`scrap`(5)、`settings/mail`(1)、
`settings`(3)、`settings/portal-accounts`(2)、`settings/quote-templates`(2)、
`settings/sync-log`(1)、`suppliers/collab`(4)、
**`app/(portal)/portal/layout.tsx:29`(在 layout 里内联解析租户)**。

**混用 repository + 裸 Prisma 的 15 个**:`bom`、`bom/version/[versionId]`、`ecn/[ecnId]`、
`materials/[mpn]`、`procurement/orders/[poId]`、`procurement/orders`、`procurement/request`、
`procurement/rfq/[id]`、`procurement/suppliers`、`quotes/[versionId]`、`reconciliation`、
`rfq/[id]`、`shortage`、`suppliers/opo`。

### (b) 路由直连 Prisma 的极端值

[app/api/search/route.ts](../../app/api/search/route.ts) —— **10 个 `findMany`**
(`:51,66,82,98,113,128,143,158,173,188`),215 行,无 repository,
唯一的域依赖是标签常量 `@/lib/domain/search-scopes`。全局搜索是一个写在路由里的跨 10 模型查询。

---

## 4. 所有 Agent / AI Provider / Tool / Use Case

**实际规模远小于目录结构的暗示:全仓只有 1 个 Agent。**

| 文件 | 行 | 职责 |
|---|---|---|
| `lib/ai/provider.ts` | 144 | 厂商中立契约、env 选型、`extractJson` |
| `lib/ai/gemini.ts` | 124 | Gemini REST(无 SDK) |
| `lib/ai/anthropic.ts` | 91 | Anthropic REST(无 SDK) |
| `lib/ai/index.ts` | 36 | `getLlmProvider()` |
| `lib/agents/types.ts` | 83 | `AgentToolDef`/`AgentStepRecord`/`AgentEvidenceRecord`/`AgentWriteProposal`/`AgentRunResult` |
| `lib/agents/quote-agent.ts` | 446 | 工具声明 + `MockQuoteAgent` + `LlmQuoteAgent` + 分类规则 + 输出对账 |
| `lib/server/repositories/agent-run.ts` | 126 | `persistAgentRun`/`getAgentRun`/`decideAgentApproval` |

### 4.1 Agent 清单

- **QuoteAgent**(唯一):入口 [quote-agent.ts:444](../../lib/agents/quote-agent.ts) `getQuoteAgent()`;
  HTTP [api/quotes/[versionId]/agent/route.ts:22](../../app/api/quotes/[versionId]/agent/route.ts);
  UI [editor.tsx:143](../../app/(app)/quotes/[versionId]/editor.tsx)。
- **声明但不存在**:`AgentType` 枚举有 `RFQ_INTAKE/BOM_MATCHING/SOURCING/QUOTE/OPO/TRACE`
  ([schema.prisma:481-490](../../prisma/schema.prisma)),TS 侧 `AgentTypeValue`
  ([types.ts:15](../../lib/agents/types.ts))**漂移:缺 `TRACE`**。BOM/RFQ/Sourcing/OPO/Trace **零实现**。
- **第二个 LLM 调用点在 Agent 体系之外**:BOM OCR
  [providers/ocr/recognize.ts:5,44](../../lib/providers/ocr/recognize.ts) 直接 `getLlmProvider()`,
  **无 AgentRun、无 step、无 evidence、无审批**。
- 命名歧义:`lib/integration/erp/` 的 "ERP Integration Agent" 是**确定性适配器**,不是 LLM Agent。

### 4.2 Tool 执行:**没有 dispatcher**

`QUOTE_AGENT_TOOLS`([:77](../../lib/agents/quote-agent.ts))被导出,但**除测试外零消费者**。
两个工具的 `inputSchema`/`outputSchema` **从不用于校验实际 I/O** ——
LLM 路径用的是另一个单独声明的 `LlmSuggestionsSchema`([:247](../../lib/agents/quote-agent.ts))。
"读工具"是把逻辑内联写死后再给 step **贴上工具名标签**([:140](../../lib/agents/quote-agent.ts) / [:348](../../lib/agents/quote-agent.ts));
"写工具"从不由 Agent 执行,而是发成 `writeProposal` 字符串,由**一个 HTTP 路由**执行。

### 4.3 CLAUDE.md 安全不变量 —— 核查结果

| 要求 | 结论 | 证据 |
|---|---|---|
| AI 不得计算价格/GTB/Markup/金额 | ✅ **守住** | 金额一律来自 [quote-calc.ts:243](../../lib/domain/quote-calc.ts) `summarizeQuote`;Agent 只产出 `suggestedMarkupPct` 字符串参数;越界值被夹到 `[0,1]` 并回落本地档位、置信度压到 0.3([:216,289-313](../../lib/agents/quote-agent.ts));审批时**只写 `materialCategory` + `markupPct`** |
| Agent 不得直连外部 API | ✅ 守住 | `quote-agent.ts` 无 `fetch`,唯一出口是 `getLlmProvider()` |
| Agent 不得直写 Prisma | ✅ 守住 | `lib/agents/**` 零 Prisma 导入 |
| 写工具必须人工确认 | ⚠️ **数据路径守住,但门是坏的** | 见 §4.4 |

### 4.4 审批门的三个缺陷

1. **无任何 UI 能到达审批端点**。`grep "agent-approvals" app components` 只命中路由文件本身;
   editor 只显示一个计数徽标([editor.tsx:383-386](../../app/(app)/quotes/[versionId]/editor.tsx))。
   **线上每一条写提案都不可达** —— 人工确认闭环在 UI 上是断的。
2. **两个端点都没有角色守卫**。只有 `requireSession()`
   ([agent/route.ts:15](../../app/api/quotes/[versionId]/agent/route.ts)、
   [agent-approvals/[approvalId]/route.ts:17](../../app/api/agent-approvals/[approvalId]/route.ts))。
   **任何已登录的租户用户都能批准 AI 写入。**
3. **P0-4:批准会抹字段**。审批路由只传 `{lineNo, category, materialCategory, markupPct}`
   ([:45-50](../../app/api/agent-approvals/[approvalId]/route.ts)),而 `upsertQuoteLine` 的 update 分支
   把其余字段按 `input.x ?? null` 装进 `data` 再 `updateMany`
   ([quote.ts:216-236](../../lib/server/repositories/quote.ts)) ——
   **批准一条 AI 分类建议,会把该行的 `qty`/`purchaseCost`/`customerPrice`/报价 MPN/厂商/备注全部置 null**,
   包括 markup 本来要乘的那个 `purchaseCost`。无测试覆盖此路径。

### 4.5 可观测性缺口

- **模型调用失败被记成 SUCCEEDED**:`LlmQuoteAgent` 捕获异常 → 记一条 FAILED **step** → 回落本地规则 →
  仍返回 `status:"SUCCEEDED", error:null`([:379-385,429,436](../../lib/agents/quote-agent.ts))。
  `JobStatus.PARTIAL_SUCCESS` 存在但从不使用。
- `AgentStep.startedAt/finishedAt`、`AgentEvidence.stepId`、`AgentApproval.stepId`、
  `AgentRun.writtenRefs`、`AgentRun.idempotencyKey`(**有 `@@unique` 却从不赋值**)—— 全部**声明了但从不写入**。
  重复 POST 运行端点会无限生成重复 run 与重复 PENDING 审批卡。
- `costUsd` 恒 `null`(**有意为之**,单价随合同变化不猜 —— 这条纪律正确,保留)。
- `getAgentRun` **无任何调用方**,没有运行历史 UI。

---

## 5. 所有 Provider

**9 个互不相干的接口,无公共基类型;7 个工厂,无统一注册表。**

| # | 接口 | 位置 | 方法数 | 实现 |
|---|---|---|---|---|
| 1 | `DistributorProvider` | [common/distributor.ts:36](../../lib/providers/common/distributor.ts) | 5 | DigiKey(+Mock)、Mouser(+Mock) |
| 2 | `EzplmPartsProvider` | [ezplm/provider.ts:23](../../lib/providers/ezplm/provider.ts) | 10 | Http、Mock |
| 3 | `MasterDataProvider` | [master-data/index.ts:24](../../lib/providers/master-data/index.ts) | — | **只是 `EzplmPartsProvider` 的类型别名**;另有 ERP-Lab 适配器 + 内联 `notConfigured()` 字面量 |
| 4 | `ErpProvider` | [erp/types.ts:370](../../lib/providers/erp/types.ts) | **23** | Kingdee、HttpErpLab、Excel、Mock、skeleton(YONYOU/SAP/ORACLE) |
| 5 | `ExcessProvider` | [excess/index.ts:50](../../lib/providers/excess/index.ts) | 2 | Unconfigured、Db |
| 6 | `MesTraceProvider` | [mes/index.ts:25](../../lib/providers/mes/index.ts) | 3 | 仅 NotConfigured |
| 7 | `BomOcrProvider` | [ocr/provider.ts:49](../../lib/providers/ocr/provider.ts) | 2 | LlmBomOcrProvider |
| 8 | FX | [fx/index.ts](../../lib/providers/fx/index.ts) | — | **无接口**,只有纯函数 `convertAmount` |
| 9 | `ApiUsageRecorder` | [common/api-usage.ts](../../lib/providers/common/api-usage.ts) | — | 横切 |

选型规则各不相同:DigiKey/Mouser/ezPLM 看 env;MasterData 看**租户设置**;
ERP 看 vendor 字符串 **且未知 vendor 静默回落 Mock**([erp/index.ts:64](../../lib/providers/erp/index.ts));
Excess 靠**探 DB 有无数据**([excess/factory.ts:16](../../lib/providers/excess/factory.ts))。
`PROVIDERS_FORCE_MOCK` 只被前三个工厂读取。

**归一化边界(好消息)**:`grep` DigiKey/Mouser 原始字段名(`ProductVariations`/`StandardPricing`/
`Availability`/`ManufacturerPartNumber` 等)在 `lib/providers/` **之外零命中** ——
业务代码没有读裸 JSON,`NormalizedOffer` 的封装是**有效的**。

**坏消息**:`NormalizedOffer` 只覆盖两个分销商。
ezPLM **从不产出 offer**(接口里没有 offers 方法);线下报价从解析行**直接写 Prisma**,
不经 DTO;`SupplierOffer` 的 schema 注释自称"NormalizedOffer 持久化"
([schema.prisma:1706](../../prisma/schema.prisma))**但两者之间没有 mapper**;
`NormalizedOfferSchema` **在生产代码中从不做运行时校验**(只在测试 helper 里用)。

---

## 6. 所有 BOM parsing / normalization / matching 实现

详见 [DUPLICATION_MATRIX.md §D1/D3/D4/D5](DUPLICATION_MATRIX.md)。摘要:

- **解析管线**:`bom-parse.ts`(575 行)一个文件里做了 列映射 → 表头检测 → 行解析 → 续行合并 →
  Value/MPN 推断 → 位号计数 → 封装代码提取 → 去向账本;下游 `bom-validate`/`bom-match`/`bom-compare`。
- **前置格式层**(职责清晰,保留):`file-parse`/`file-sniff`/`pdf-table`/`html-table`/`sexpr`/`kicad-*`。
- **匹配**:`bom-match.ts`(573 行)—— R4 加入 `QC_MFG_MFR_MPN`/`QC_MFG_MPN` 通道后已是 3 层 6 步。
- **对账账本**:`bom-ledger` + `RawBomRow` 原始行留痕 —— **这是全仓最好的设计之一,不动**。

**P0-1 就在这条链上**(§Executive Summary,证据见 DUPLICATION_MATRIX §D1.1)。

---

## 7. 所有 Manufacturer / MPN / Package normalization 实现

**MPN 键 7 个 TS 规则 + 2 个 SQL 规则 + 9 处内联复制;
制造商 5 处 + 1 处带外;封装 5 处。** 逐条见 [DUPLICATION_MATRIX §D1/D2/D4](DUPLICATION_MATRIX.md)。

最需要记住的一条:`lib/providers/common/mpn.ts` 的 `normalizeManufacturer` **保留空格、剥公司后缀**,
而 `lib/domain/part-mfg.ts` 的 `manufacturerKeyOf` **剥空格、保留后缀** ——
`resolveManufacturer` 在**同一个函数体内同时使用这两套**。

---

## 8. 所有 Supplier Quote mapping

**5 种机制 / 9 份字段集定义 / 3 套取值解析规矩 / 7 种阶梯价 DTO / 3 种持久化形状。**
详见 [DUPLICATION_MATRIX §D5/D6](DUPLICATION_MATRIX.md)。

**最高风险(P0 候选)**:同一业务事件"供应商报价"按**进入通道**落到互斥的两套模型,
且只有其中一套进入价格池 —— 走哪个通道决定了这个价格是否参与成本矩阵。

---

## 9. 所有 Alternate scoring / ranking / compatibility 实现

**3 套互不通信的引擎、3 张互相冲突的 source-trust 表、15 处独立结果对象构造。**
详见 [DUPLICATION_MATRIX §D7/D8](DUPLICATION_MATRIX.md)。

除 P0-2(量纲不比)与 P0-3(参数只填封装)外,还有 4 个**当前即生效**的退化:

| 现象 | 证据 |
|---|---|
| `pinMapVerified` 全仓无生产写入方 → 每个 PIN_TO_PIN 候选恒被警告并封顶 88 | [alternate-score.ts:98,214,227](../../lib/domain/alternate-score.ts) |
| `domestic`/`unitPrice`/`stock` 同样无写入方 → DOMESTIC 与 LOW_COST 排序分支**不可达** | [alternate-score.ts:279-291](../../lib/domain/alternate-score.ts) |
| 去重键不含制造商 → 同 MPN 两厂商塌缩成先到的那个 | [alternate-search.ts:133](../../lib/server/repositories/alternate-search.ts) |
| `PACKAGE_SCORE.UNKNOWN(100) > DIFFERENT(50)` → 封装未知比已知不同得分更高 | [alternate-compat.ts:87-92](../../lib/domain/alternate-compat.ts) |
| `part-detail.ts` 相似度语料 `take: 5000` **无截断提示**(而 `alternate-search` 用 20000 且显式降级上报) | [part-detail.ts:304](../../lib/server/repositories/part-detail.ts) |

**做得对、必须继承的**:`UNKNOWN ≠ 0 ≠ 通过` 的三值纪律在
[param-compare.ts:32-36,149-150](../../lib/domain/param-compare.ts)、
[similarity.ts:71](../../lib/domain/similarity.ts)、
[alternate-bulk.ts:124-137](../../lib/domain/alternate-bulk.ts) 执行得**严格且一致**
(唯一例外是上表最后第二行)。这正是 altpart-pro 的核心纪律,本仓已经有了。

---

## 10. 所有重复 API endpoint

153 个路由。完整清单与调用点见 agent 证据;此处只列**确认的重复/冲突**:

| # | 重复 | 两端 | 差异 | 调用方 |
|---|---|---|---|---|
| **A1** | RFQ 附件上传 | `rfq/[id]/attachments`(98) vs `upload/rfq-attachment`(144) | 同一 `addRfqAttachment`;前者多文件、被中间件限到 10MB,后者单文件流式、豁免中间件 | **旧的只有 E2E 调用**,UI 只用新的 |
| **A2** | 线下报价录入 | 5 条路径 → **2 个模型** | `SupplierQuote(Line)` vs `SupplierOffer+PriceBreak` | 见 §8;比价只读前者 |
| **A3** | "解决异常行" | `procurement/lines/[lineId]/resolve` / `procurement/orders/lines/[lineId]/resolve` / `reconciliation/lines/[lineId]/resolve` | 同结构同枚举(前两个枚举**完全相同**);**只有第一个有角色守卫** | 后两个**零调用方** |
| **A4** | ERP 同步 | Stack A `erp/**`(权限守卫 `erp.*`)vs Stack B `integration/**`(内联角色) | 两边都提供"重试失败同步",权限语义不同 | 各有各的 UI |
| **A5** | ERP 导出模板 | `opo/erp-export` vs `procurement/orders/[poId]/erp-export` | 同一 `createErpExportJob`,前者租户级、后者单 PO | 各有 UI(合理,但应共用子资源命名) |
| **A6** | 相同 DTO | `LineSchema` 在 `procurement/orders/route.ts:12-25` 与 `.../[poId]/lines/route.ts:8-21` **逐字段相同** | — | — |

**命名不一致**(第十三节点名的那一对确实存在):
`procurement/rfq/[id]/*`(4 文件)与 `procurement/rfqs/[prfqId]/*`(4 文件)是**同一资源**,
且**被同一个页面同时调用**([sourcing-panel.tsx:112](../../app/(app)/procurement/rfq/[id]/sourcing-panel.tsx) 用 `/rfq/`,
[quote-link.tsx:28](../../app/(app)/procurement/rfq/[id]/quote-link.tsx) 用 `/rfqs/`)。

更普遍的问题:**20 个不同的动态段名对应约 8 类实体**。`[id]` 在 5 处指 5 种不同实体;
`[jobId]` 指 2 种;**`[lineId]` 指 7 种不同的行**(BOMLine / SupplierQuoteLine / PurchaseOrderLine /
ReconciliationLine / OpoLine / ShortageLine / QuoteLine)。

**孤儿端点(UI/测试皆无调用):21 个**,含 `agent-approvals/[approvalId]`(§4.4)、
`bom/import/[jobId]/stream`、`materials/parts/[partId]/mfg-mappings`、
`procurement/supplier-recommendation`、`procurement/rfqs/[prfqId]/quote-upload` 等。

导出接口 **17 个,三套命名约定**(`/export` 后缀、`-export` 后缀、`?export=1` 查询参数)。

---

## 11. 超过 500 行的生产文件

| 行 | 文件 | 类型 |
|---|---|---|
| **4232** | `prisma/schema.prisma` | 单文件 schema(125 model / 80 enum) |
| 990 | `lib/server/repositories/traceability.ts` | 混合:导入 + 图查询 + 审批 + 拆并 + 替代(16 导出 / 7 事务 / 8 审计) |
| 858 | `lib/server/repositories/erp-sync.ts` | 集成 + 持久化 + 重试策略域 |
| 725 | `lib/server/repositories/supplier-action.ts` | 35 处 Prisma / 9 审计 / 公开 token 面 |
| 641 | `lib/server/repositories/bom-import.ts` | 30 处 Prisma / 3 事务 / 作业状态机 / 3 个 Provider |
| 631 | `lib/server/repositories/quote.ts` | 状态机 + 快照 |
| 626 | `lib/server/repositories/purchase-order.ts` | 状态机 + OPO 物化 |
| 577 | `lib/server/repositories/part-detail.ts` | **12 个 Provider 导入** + 域排序 + 9 处 Prisma,只导出 1 个函数 |
| 575 | `lib/domain/bom-parse.ts` | 8 职责合一 |
| 573 | `lib/domain/bom-match.ts` | **域层持有 Provider 实例并直接发起外部调用** |
| 570 | `app/(app)/procurement/rfq/[id]/sourcing-panel.tsx` | 客户端组件 |
| 564 | `lib/providers/erp/lab/index.ts` | 23 方法实现 |
| 545 | `app/(app)/materials/create-part-drawer.tsx` | 客户端组件 |
| 535 | `scripts/uat/qianchuang/analyze.ts` | 一次性审计脚本(可接受) |
| 523 | `lib/server/repositories/ecn.ts` | 状态机 |
| 519 | `lib/server/repositories/part-create.ts` | 查重 + 建料 + 评审 + 批量 |
| 513 | `app/(app)/materials/[mpn]/page.tsx` | 服务端页面 |

### 12. 超过 1000 行的生产文件

**只有 `prisma/schema.prisma`(4,232 行)。** TS 侧最大 990 行。
—— 这说明单文件膨胀**不是**本仓主要矛盾;矛盾是**横向重复**与**层次错位**。

### 11.3 附:租户守卫纪律

`tenantWhere` 641 处、`tenantData` 206 处、135 个文件导入 —— 覆盖率很高。
但 **`assertTenantScopedMutation` 在 `app/`、`lib/`、`scripts/` 中零调用**
([tenant-scope.ts:41](../../lib/server/tenant-scope.ts) 定义,仅被两个测试文件引用)。
CLAUDE.md 声明的"update/delete 必须经断言守卫"**在运行时从未执行**。

246 处写操作中,**58 处的 `where` 既无 `tenantWhere(...)` 也无字面 `tenantId`**。
绝大多数是"先按租户读、再按主键写",实践上安全,但绕开了声明的守卫;
其中 **7 处连上下文里都找不到租户谓词**:`audit.ts:91`、`rate-limit.ts:83`(全局桶,有意)、
`purchase-order.ts:416`、`ecn.ts:124`、`part-mfg-mapping.ts:129`、`erp-sync.ts:292`、`erp-sync.ts:684`。

---

## 13. 所有 deprecated / compatibility / legacy 路径

全仓 `TODO/FIXME/XXX/HACK` **仅 1 处**,且是一句说明性注释
([erp/mock/index.ts:240](../../lib/providers/erp/mock/index.ts))—— 注释纪律非常好。

真正的 legacy 面:

| 项 | 状态 | 证据 |
|---|---|---|
| `legacy-static/` | 8.0MB / 141 文件;代码中**仅 1 处注释引用** | [nav-icon.tsx:3](../../components/shell/nav-icon.tsx) |
| `reference/nestjs-v15/` | **目录不存在**;INTEGRATION_PLAN §九 已记录"永久缺失、路径作废" | — |
| `rfq/[id]/attachments` | 旧上传端点,代码里**自己指明了继任者** | [route.ts:39](../../app/api/rfq/[id]/attachments/route.ts) |
| `Part.mpn` | R4 起降级为"首选缓存",真源是 `PartMfgMapping` | schema 注释 |
| `PartAlternate.grade` 自由文本 | 遗留列(`完全替代`/`条件替代`),**从不参与评分**,与三轴枚举并存 | [schema.prisma:1535](../../prisma/schema.prisma) |
| `lib/auth/token-verifier.ts` | 46 行,**全仓零引用(含测试)**;是 CLAUDE.md 要求的 SSO 预留钩子 | — |
| `lib/providers/fx/` | `convertAmount` **无任何生产调用方**,仅单测;`prisma.fxRate` 从不被查询 | — |
| `components/ui/module-placeholder.tsx` | `ModulePlaceholder` 零调用方 | — |
| `lib/integration/erp/sources/kingdee/api/` | R4-11 骨架,仅测试引用(**预期**,等金蝶文档 O1) | — |
| 21 个孤儿 API 端点 | 见 §10 | — |
| 20+ 条已合并的本地分支 | `feat/f1-*`…`feat/pr-a-*` | `git branch` |

完整分级见 [DEPRECATION_CANDIDATES.md](DEPRECATION_CANDIDATES.md)。**REF-0 不删任何东西。**

---

## 14. "保留因为旧 SPEC" 类代码

没有 `TODO` 形式的,但有 4 类事实上的"为兼容旧口径而保留":

1. **`lib/routes.ts` 的 `plannedPr` / `implemented`** —— 交付计划元数据混在路由表里,
   16 个 `implemented: true`、**0 个 `false`**、17 个靠"缺省视为已实现"。
   `unimplementedRoutes()` 当前返回空数组,但 [routes.test.ts:101-127](../../tests/unit/routes.test.ts)
   仍拿它与文件系统里的 `ModulePlaceholder` 做双向校验 —— 而 `ModulePlaceholder` 组件本身已无调用方。
   这是一条**自洽但已空转**的约束。
2. **`Part.rohs/reach` 与 `PartComplianceDeclaration` 并存** —— PR-F 有意保留旧列
   (PRODUCTION_HARDENING_REPORT §二:"旧字段一律保留…新逻辑读新字段,两者并存")。
3. **`ErpSyncJob` 与 `IntegrationSyncRecord` 双状态机** —— ROUND2_AUDIT §3.2 明确"扩展而非另起",
   现状是两者并存且**两套 API + 两套权限语义**(§10 A4)。
4. **`SEARCH_SCOPES`(给人看的中文)与 `ROLE_ENTITIES`(可执行)双份** ——
   [search-scopes.ts:4-5](../../lib/domain/search-scopes.ts) 自述"两者必须同源变化",
   靠单测锁标签相等;**而 SUPPLIER 两边已经不一致**(rbac 写 `["OPO(本供应商)"]`,search-scopes 写 `[]`)。

---

## 15. 当前测试覆盖对应关系

| 层 | 文件数 | 说明 |
|---|---|---|
| `tests/unit/` | 128 | 域函数覆盖良好 |
| `tests/e2e/` | 60 | Playwright,CI 必过 |
| `tests/golden/` | 8 | 金样数据完整性,CI 单列一步 |
| `tests/uat/qianchuang/` | 4 | 真实私有夹具(env 缺失即 FAIL) |

CI 门禁([.github/workflows/ci.yml](../../.github/workflows/ci.yml))实跑:
`prisma generate` → `prisma validate` → `lint` → `typecheck` → `test` → **`test:golden`** →
`build` → `migrate deploy` → `test:e2e`。**未削减任何门禁**;`test:uat:qianchuang` 不在 CI(私有夹具)。

### 15.1 覆盖缺口(按重构风险排序)

| 缺口 | 数据 |
|---|---|
| **repository 层几乎无单测** | **38 个中 35 个在 `tests/` 里零引用**;只有 `bom-import`、`erp-sync`、`traceability` 各被 1 个测试文件引用。整层的安全网**只有 E2E** |
| `lib/domain/column-mapping.ts` **零直接单测** | 7 个消费者依赖它,是本轮要升级的基座,只有间接覆盖 |
| CJK MFG_PN 无用例 | [bom-match-v3.test.ts](../../tests/unit/bom-match-v3.test.ts) 的 `mfgByMpnKey` 全用 ASCII 构造 → P0-1 逃逸 |
| Agent 审批路径无测试 | `persistAgentRun`/`decideAgentApproval`/两个路由**均无测试** → P0-4 逃逸 |
| 量纲比较无用例 | `72 MHz` vs `72 MB` 无断言 → P0-2 逃逸 |
| 其余无同名单测的域模块 | `bom-compare`、`csv`、`kicad-footprint`、`kicad-symbol`、`offers`、`price-pool`、`quote-tasks`、`sexpr`、`supplier-strategy`(均有间接引用) |

**结论(直接决定 MIGRATION_PLAN)**:因为 repository 层没有单测,
**任何 repository 重构都不能靠"改完跑测试"验证** —— 必须走第十九节的 Golden Master 对拍
(旧实现为生产结果、新实现影子计算、逐字段 diff),这不是可选项。

---

## 16. 技术债分级汇总

完整条目(含 Files / Risk / Target / Migration / Tests / Acceptance)见
[REFACTOR_BACKLOG.md](REFACTOR_BACKLOG.md)。此处只给分布:

| 级别 | 数量 | 代表 |
|---|---|---|
| **P0 correctness** | 8 | CJK 键失配、量纲不比、候选只填封装、审批抹字段、报价通道分叉、Agent 端点无角色守卫、`assertTenantScopedMutation` 零调用、**零价格守卫只接上 1/4 路径** |
| **P1 architectural duplication** | 18 | 7 套 MPN 归一、5 处厂商归一、3 套替代料引擎、10 份列映射词表、15 处结果对象构造、双 ERP 同步栈、单复数命名分叉、缺失 application 层、**聚合粒度分层**、**核对未完成即可对外询价**、**比价导出缺数量列**、**无 MPN 行被硬丢且不告知** |
| **P2 maintainability** | 14 | 34 个页面直连 Prisma、8 个混合型 repository、`routes.ts` 十职合一、`demo-reset-plan` 强耦合(21 次提交)、Provider 工厂三份复制 memo、17 个导出三套约定、**客户报价单 26 列导出契约未固化**、**损耗率不可配** |
| **P3 cleanup** | 9 | `legacy-static/`(**已执行归档**)、21 个孤儿端点、死组件与死模块、20+ 条陈旧分支、`@prisma/client` 版本 `^` 漂移 |

**依赖版本漂移(第十七节点名的)已确认存在**:
`prisma` = `7.9.0`(精确)、`@prisma/adapter-pg` = `7.9.0`(精确)、
**`@prisma/client` = `^7.9.0`(带 caret)** —— 三者必须完全一致,当前不一致。

---

## 17. REF-0 结论与建议的下一步

1. **先修 P0,再动架构。** 四个 P0 都是小改动、可独立回滚、且**每一个都能用一条回归用例钉死**。
   把它们和 REF-1 的大重构混在一起,会让 Golden Master 对拍失去基准
   (无法区分"差异是修 bug"还是"差异是重构引入")。建议插入 **REF-0.5:P0 修复 + 回归用例**。
2. **REF-1 的前置是测试,不是代码。** repository 层 35/38 无单测 —— 在建 Canonical Part Identity 之前,
   必须先有对拍夹具与 shadow-run 框架,否则第十九节的 Golden Master 无从执行。
3. **不要从 bom2buy / altpart-pro 复制代码。** 两个参考仓的**规则**成熟(尤其 altpart-pro 的
   QuantityIR / 条件参数 / `pinVerified` 硬门 / 三值 UNKNOWN,和 bom2buy 的列字典 / 位号 / 厂商别名),
   但两者都**没有租户、没有审计、没有人工确认、无类型**,且各自带着本仓已经解决过的债
   (altpart-pro 的双 builder 漂移、bom2buy 的 UI 重复实现 header 检测)。
   本仓的纪律优于参考仓,采规则、弃实现。
4. **`lib/integration/erp/` 是样板,不是目标。** 它已经是 `profiles → sources → canonical → normalization`
   的分层,REF-1+ 应把其它 context 拉向这个形状,而不是反过来改它。

**REF-0 到此为止。**

> **2026-09-17 更新**:三件待决事项已全部确认(接受 REF-0.5/REF-0.8;线下报价同权参与比价;
> `legacy-static` 归档移出并已执行),下一步从 **REF-0.5** 开工 ——
> 建议内部顺序 R0-1 → R0-8 → 其余,因为这两项直接对应客户验收面(匹配率 95+%、零价计入合计)。
> 决策记录见 [MIGRATION_PLAN.md §0′](MIGRATION_PLAN.md)。
