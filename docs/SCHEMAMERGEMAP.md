# SCHEMA 合并对照表(NestJS V15 ↔ SPEC §4)

> **状态:⚠️ 阻塞 — 旧 schema 输入缺失,本文件目前只是对照框架,不是完成品。**
>
> - 依据 `SETUP.md`,`reference/nestjs-v15/` 应由人工放入旧后端的 `schema.prisma`(42 表/41 枚举);
>   截至 PR1 提交时该目录为**空**,git 全部历史中也从未包含过任何 `.prisma` 文件。
> - 因此下表的"旧表(NestJS V15)"列**全部待补**,旧表→新表映射、废弃表清单、字段级差异
>   均无法如实产出。按诚实汇报纪律,本 PR 不编造旧表清单。
> - **解除阻塞方式**:将 `schema.prisma` 放入 `reference/nestjs-v15/` 后,在下一会话指示
>   "补全 SCHEMAMERGEMAP",即可在 PR2 落库前完成本表(整合方案第六节:schema 是最不能返工的东西,
>   本表必须先经人工评审,再动 Prisma)。
>
> 本文件中**新模型侧(SPEC §4 的 43 个模型)是完整、确定的**,并已按域分组、标注用途与关键约束,
> 可先行评审;旧表侧到位后按"对照方法"一节填充。

## 一、新 schema 模型清单(SPEC §4,共 43 个模型)

全部业务表带 `tenantId`;update/delete 必须 tenant scoped;写操作记 AuditLog(CLAUDE.md 硬性约束 4)。
`Tenant`/`User` 含可空融合字段 `ezplmTenantId` / `externalUserId`(融合钉子 2)。

### 1. 租户与主体

| # | 新模型 | 用途 / 关键约束 | 旧表(NestJS V15) |
|---|---|---|---|
| 1 | Tenant | 租户;含可空 `ezplmTenantId` | ⏳ 待旧 schema |
| 2 | User | 用户;含可空 `externalUserId`(SSO 预留) | ⏳ |
| 3 | Role | 角色:PM / PROCUREMENT / ENGINEERING / MANAGEMENT / SUPPLIER(无其他审批角色) | ⏳ |
| 4 | UserRole | 用户-角色多对多 | ⏳ |
| 5 | Customer | 客户(如示例数据中的联创科技) | ⏳ |
| 6 | Supplier | 供应商 | ⏳ |
| 7 | SupplierContact | 供应商联系人(供应商邮件建档回填目标) | ⏳ |

### 2. RFQ 域(本系统唯一真源)

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 8 | RFQ | 状态机 DRAFT→RECEIVED→PARSING→WAITING_ENGINEERING→WAITING_PROCUREMENT→QUOTING→PENDING_APPROVAL→QUOTED / CLOSED_NO_QUOTE / LOST | ⏳ |
| 9 | RFQAttachment | Gerber/PDF/图片/工艺说明;保留原始客户文件;标记附件类型 | ⏳ |
| 10 | RFQStatusHistory | 状态流转处理记录 | ⏳ |

### 3. BOM 域

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 11 | BOM | RFQ 可关联多个 BOM | ⏳ |
| 12 | BOMVersion | 版本比对基础 | ⏳ |
| 13 | BOMLine | 行级数据;重复位号/EOL/封装校验对象 | ⏳ |
| 14 | BOMImportJob | >50 唯一 MPN 走分批(10–20/批)+ SSE/轮询进度 | ⏳ |

### 4. 物料域(ezPLM 只读真源 + 本地缓存)

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 15 | Part | 物料主数据镜像;按整合方案 3.2 追加 dateCode/msl/包装字段(挂 PR5) | ⏳ |
| 16 | PartIdentifier | 内部料号/MPN 等标识 | ⏳ |
| 17 | CustomerPartMapping | 客户料号映射(BOM 匹配顺序第 1 位) | ⏳ |
| 18 | PartAlternate | 替代关系 | ⏳ |
| 19 | InventorySnapshot | 库存快照(ezPLM 只读来源) | ⏳ |
| 20 | OpenPOLine | 在途(GTB 扣减项) | ⏳ |
| 21 | BomMatchCandidate | 匹配候选:来源/置信度/生命周期/呆滞/OPO/ETA/数据更新时间 | ⏳ |
| 22 | BomLineDecision | 人工确认结果(AI 只建议,不落定) | ⏳ |
| 23 | ExternalPartSnapshot | 外部数据缓存快照(禁止双写 ezPLM) | ⏳ |

### 5. 报价供应域

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 24 | SupplierOffer | NormalizedOffer 持久化;线下 Excel 与三源统一 | ⏳ |
| 25 | PriceBreak | 价格阶梯(确定性函数 getApplicablePriceBreak 输入) | ⏳ |

### 6. 报价域(Quote,本系统唯一真源)

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 26 | Quote | 状态机 DRAFT→PENDING_APPROVAL→APPROVED/REJECTED/EXPIRED;PENDING/APPROVED 参数冻结 | ⏳ |
| 27 | QuoteVersion | 修订版;退回出新 Revision,禁止覆盖已批准版本;存 submittedSnapshot/approvedSnapshot | ⏳ |
| 28 | QuoteLine | 行含 MFG/MPN/Markup/物料类别/替代料/采购成本/PPV;拆材料/人工/NRE/SMT/DIP/测试/管理费 | ⏳ |
| 29 | QuoteApproval | 审批记录;审批人必须在角色模型内 | ⏳ |

### 7. 采购 RFQ 域

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 30 | ProcurementRFQ | 采购比价流程;现货/期货模式 | ⏳ |
| 31 | SupplierQuote | 供应商报价;换货源必须记录新供应商/币种/MOQ/SPQ/LT/报价时间 | ⏳ |
| 32 | SupplierQuoteLine | 行级;wasFlagged 原始异常集合固化在此域 | ⏳ |
| 33 | PurchaseRequest | PM 端采购申请单(整合方案 3.2,挂 PR6) | ⏳ |

### 8. OPO 域(行级唯一数据源)

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 34 | OPOLine | KPI/未回复/差异/异常全部派生,禁止旁路计数 | ⏳ |
| 35 | OPOReply | replyEta/replyQty/replyNote/replyAt/replySource | ⏳ |
| 36 | ReminderLog | 提前 4 天催办;幂等键防重发 | ⏳ |

### 9. 智能体域(全部新增,旧系统无对应)

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 37 | AgentRun | 输入/工具/证据/输出/人工确认/写入结果/失败/token 成本/时间 | (预计新增) |
| 38 | AgentStep | 步骤明细 | (预计新增) |
| 39 | AgentEvidence | 外部数据证据 | (预计新增) |
| 40 | AgentApproval | 写工具确认卡片记录 | (预计新增) |

### 10. 平台域

| # | 新模型 | 用途 / 关键约束 | 旧表 |
|---|---|---|---|
| 41 | AuditLog | 每个写操作:tenantId、userId、时间 | ⏳ |
| 42 | IntegrationJob | 失败任务重试;ERP Excel 模板兜底路径 | ⏳ |
| 43 | ApiUsageLog | DigiKey/Mouser 限流与配额记录(X-RateLimit) | ⏳ |

> 注:SPEC §4 原文清单 Tenant…ApiUsageLog 逐一清点为 **43 个模型名**,上表无增删、
> 仅按域分组;与整合方案中"旧后端 42 表"是两套数字(旧表数以实际 schema.prisma 为准)。

## 二、对照方法(旧 schema 到位后执行)

1. **逐表三分类**:旧表 → ①映射(改名/合并到新模型)②废弃(功能超出一期范围:品质/PPAP/RMA/SN 追溯/完整 ECN 等,标 feature flag/backlog)③保留原样迁移。
2. **字段级差异要点**:对映射表逐字段列 增/删/改名/类型变更/约束变更(重点:tenantId 补齐、快照字段、状态机枚举差异)。
3. **枚举对照**:旧 41 枚举 ↔ 新状态机(RFQ 10 态、Quote 5 态、角色 5 种);多余枚举归入废弃清单。
4. **新增表确认**:预计增量为 RFQ 族、Agent 族、ExternalPartSnapshot、SupplierOffer/PriceBreak、ProcurementRFQ 族(整合方案第二节);以实际旧 schema 比对为准。
5. 产出经人工评审后,才作为 PR2 Prisma 落库的输入。

## 三、当前状态汇总

| 交付项 | 状态 |
|---|---|
| 新模型清单(SPEC §4)分域整理 + 约束标注 | ✅ 完成,可评审 |
| 旧表→新表映射 | ⛔ 阻塞:`reference/nestjs-v15/schema.prisma` 缺失 |
| 废弃表清单 | ⛔ 同上 |
| 字段级差异要点 | ⛔ 同上 |
