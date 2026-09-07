# F2 检查点 A · ECN-Lite —— Schema 草案 + 状态机转移表

> 按 KICKOFF_ROUND2.md §F2 要求先行交付,随 PR 评审;异议以批注为准返工。
> 页面与影响分析按 docs/PAGE_SPEC_ECN.md 实施。

## 1. Schema 草案(按既有 schema 纪律自查)

| 模型 | 关键字段 | 纪律自查 |
|---|---|---|
| `Ecn` | code(租户内唯一)、title、type、priority、status、customerId?、productName?、reason、effectiveStrategy?/effectiveAt?、dueDate?、releasedSnapshot Json、void 三件套(reason/At/ById) | tenant unique ✓(`@@unique([tenantId, code])`);快照 Json 理由:与 Quote 快照同模式 —— 发布即冻结文档,后续改动不回写 |
| `EcnChangeLine` | ecnId FK、lineNo、bomId?/bomVersionId?(**标量**)、旧/新 内部料号+MPN、qtyImpact Decimal?、reason、engineeringNote、procurementNote | 聚合内 FK(EcnChangeLine→Ecn)✓;跨聚合(BOM)用标量 ✓;数量 Decimal ✓ |
| `EcnApproval` | ecnId FK、stage(三值枚举)、decision、comment、decidedById、decidedAt | 聚合内 FK ✓;审批人只可能是五角色内的用户 |
| `EcnCustomerNotice`(T2) | ecnId FK、customerId(标量)、required、contractNote(自由文本,**不建合同模型**)、status(DRAFT/SENT/REPLIED)、expectedReplyAt、outboundMessageId? | 发送状态经既有 OutboundMessage,不伪造 |
| `BOMVersion.ecnId?` | Apply to BOM 回链(BOM 详情版本图谱据此标 ECO 分支) | 跨聚合标量 ✓ |

阶段配置:`TenantSettings.ecnReviewStages = { engineering: bool, procurement: bool }`
(MANAGEMENT 批准阶段**不可关**);角色只取五值枚举,无品质/总经理。

## 2. 状态机转移表

| From | To | 触发人 | 前置条件 | 审计动作 |
|---|---|---|---|---|
| DRAFT | REVIEW | 发起人/PM/工程 | ≥1 条变更行 | ECN_SUBMIT |
| REVIEW | REVIEW(阶段推进) | 当前阶段角色 | 按启用阶段顺序 ENGINEERING→PROCUREMENT→MANAGEMENT 逐段通过 | ECN_STAGE_APPROVE |
| REVIEW | DRAFT | 当前阶段角色 | 退回**原因必填** | ECN_STAGE_REJECT |
| REVIEW(末段通过) | CUSTOMER_CONFIRM | 系统随末段通过 | flag `ecn.customerNotice` 开 且 存在 required 告知 | ECN_STAGE_APPROVE |
| REVIEW(末段通过) | APPROVED | 系统随末段通过 | 无需客户确认 | ECN_STAGE_APPROVE |
| CUSTOMER_CONFIRM | APPROVED | PM/管理层 | 人工确认客户已知悉(备注可填) | ECN_CUSTOMER_CONFIRMED |
| APPROVED | RELEASED | 管理层 | 冻结 releasedSnapshot(头+行+审批史) | ECN_RELEASE |
| RELEASED | CLOSED | 管理层/PM | 人工关闭 | ECN_CLOSE |
| DRAFT/REVIEW/CUSTOMER_CONFIRM/APPROVED | VOIDED | 管理层(或发起人限 DRAFT) | 原因必填;**RELEASED 不可作废**(已发布只能 CLOSE,现实无法撤回) | ECN_VOID |

- VOIDED/CLOSED 为终态;VOIDED 可查可溯,禁物理删除;
- **Apply to BOM 不是状态转移**:仅 RELEASED 可执行,显式二次确认,替换匹配旧料的行生成**新 BOMVersion(ecnId 回链)**,原版本不动;逐行替换结果(命中/未命中)如实回报;
- 参数冻结:REVIEW 起头/行不可改(退回 DRAFT 才可改)。

## 3. T2 影响分析(flag `ecn.impactAnalysis`)数据源矩阵与降级

| 数据项 | 来源 | 缺源/失败表现 |
|---|---|---|
| 影响 BOM/版本 | 本系统 BOMLine 反查旧料 | 永远可用 |
| 旧料/替代料库存(仓/批次) | ErpProvider.pullInventory | NOT_CONFIGURED→「待接入」;调用失败→该卡「数据源失败(原因)」,**其它卡照常** |
| 在途 PO | pullOpenPurchaseOrders | 同上 |
| 呆滞 | pullExcessReport | 同上 |
| 受影响工单 | pullWorkOrders(LAB-1 已扩展;本 PR 同步主仓合约镜像) | 同上;`WORK_ORDER_SOURCE_UNAVAILABLE` 场景即验证此降级 |
| 未发货销售订单 | pullSalesOrders(镜像同步新增) | 同上 |
| 估算报废金额 | 旧料库存 × 最近采购成本 | 无成本源→「无法估算(缺采购成本)」,不填 0 |

每卡显示来源与数据时间;AI 建议(生效策略/处置)仅建议卡,**不写入任何字段**。

## 4. 导出
CSV:Header + Change Lines + Approval History + Affected BOM + Notes(复用 toCsv);影响报告为可选附录。
