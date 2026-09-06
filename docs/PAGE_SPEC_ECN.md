# PAGE SPEC · ECN(ECN-Lite 核心 + 影响分析扩展)

来源:`legacy-static/customer-demo/ecn-detail.html`(客户测试版,ECN-2026-0425-007 "USB 接口 EOL 替换")。该页是二期级的完整 ECN(Blast Radius、生效策略 AI 推荐、旧料处置、客户告知函、7 节点跨部门评审、MES 同步指令)。本规格按范围分层:**T1 = ECN-Lite 核心(与 KICKOFF_ROUND2 F2 一致)**,**T2 = 影响分析扩展(Feature Flag,数据经 ERP Provider,可由 ERP Lab 闭环验证)**,**T3 = 二期/待商务确认**。

---

## 0. 角色与流程的硬性修正
静态页评审链含"品质 QE""总经理"——**不在五角色模型内**。实现时:
- 评审阶段固定为:ENGINEERING(工程评审)→ PROCUREMENT(采购确认)→ MANAGEMENT(批准);PM 为发起人;
- "总经理最终批准"映射为 MANAGEMENT;"品质确认"**不设阶段**,在 INTEGRATION_PLAN 待商务确认池登记"ECN 是否需品质评审阶段";
- 阶段配置化(租户级可启停某阶段),但角色只能取五值枚举;
- 无流程引擎、无"流程模板/流程模拟器"字样。

---

## 1. ECN 列表(T1)
路由 `/ecn`。列:ECN No、标题、类型、优先级、状态、影响 BOM/版本、产品、更新时间、(T2 开启时)影响摘要。组合筛选:status/type/priority/customer/date。KPI(走 `lib/metrics`,可下钻):Active、Awaiting Review、Customer Confirmation、Overdue、Released This Month。

## 2. ECN 详情头部(T1)
路由 `/ecn/[id]`。PageHeader/Breadcrumb/返回列表;显示 ECN No、标题、类型、优先级、状态徽标、产品、客户、发起人/日期、截止/生效日期;按钮按状态与权限显示:保存草稿 / 提交评审 / 通过 / 退回(原因必填)/ 发布 / 作废(原因必填);无权限时只读并注明"您无权审批此 ECN"。

## 3. 变更行(T1)
多行 EcnChangeLine:影响 BOM/版本、旧内部料号/MPN、新内部料号/MPN、数量影响、原因、工程备注、采购备注。支持 XLSX/CSV 模板导入。**新料候选可从既有 PartAlternate 或 SupplierOffer 引用,不新建替代料模型。**

## 4. 评审与审批历史(T1)
EcnApproval 按阶段记录 approver/decision/comment/decidedAt;时间线组件复用 AuditLog 时间线;每次动作写 AuditLog。

## 5. 发布与 Apply to BOM(T1)
Release 冻结 approved snapshot(Json 冻结文档,与 Quote 快照同模式)+ 影响 BOM/版本 + who/when。**不自动改 BOM**;"Apply to BOM"为独立显式动作 + 二次确认,生成新 BOMVersion 并回链 ecnId(供 BOM 详情版本图谱标注 ECO 分支)。VOIDED 可查可溯,禁物理删除。

## 6. 导出(T1)
Header + Change Lines + Approval history + Affected BOM + Notes(XLSX/PDF 任一,复用既有导出框架)。

---

## 7. 影响分析 · Blast Radius(T2,Feature Flag `ecn.impactAnalysis`)
静态页最有价值的部分。**定位为只读分析面板**,数据全部经 Provider 派生,**不做任何自动动作**。

数据来源与可得性(对照 ERP Lab 当前合约):
| 影响项 | 数据源 | 现状 |
|---|---|---|
| 影响 BOM / 版本 | 本系统 BOMLine 反查旧料 | ✓ 可做 |
| 旧料库存(数量/仓位/批次)| `ErpProvider.pullInventory`(含 warehouse、lotNo、customerCode)| ✓ Lab 已支持 |
| 在途采购(PO/数量/到货)| `ErpProvider.pullOpenPurchaseOrders` | ✓ Lab 已支持 |
| 替代料库存 | `pullInventory` 按新料查询 | ✓ |
| 呆滞 | `pullExcess` | ✓ |
| **受影响工单**(在制/待投产/已出货)| ERP 工单 | ✗ Lab 无 → 需 LAB-1 扩展(见 KICKOFF_ROUND2)|
| **未发货销售订单**(客户/数量)| ERP 销售订单 | ✗ Lab 无 → LAB-1 |
| 估算报废金额 | 旧料库存 × 采购成本(SupplierOffer/PurchaseCost)| ✓,币种标注 |

面板内容:
- 摘要卡:影响 BOM 数、旧料库存(总量/批次/仓位)、在途 PO、替代料库存、(有工单源时)受影响工单数与分布、(有销售源时)未发货订单数;每卡显示数据来源与更新时间;来源缺失显示"数据源待接入",**禁止 0 或示例数**;
- 明细表:库存批次表、在途 PO 表、(可得时)工单表(工单号/客户产品/数量/当前工序/已用本物料 → **"建议操作"仅为 AI 建议文本,须人工在变更行备注中确认**);
- 导出影响报告(与 §6 导出合并为一份可选附录)。

**生效策略**:静态页三选项(立即 / 工单结束后 / 指定日期)保留为 ECN 头部的枚举字段 `effectiveStrategy` + `effectiveAt`,由人工选择;AI 推荐仅作建议卡(须显示依据数据与时间),**不得自动写入**;库存"消化/降级/报废"处置策略作为建议文本,决策记录到 procurementNote。

## 8. 客户告知(T2 轻量,Feature Flag `ecn.customerNotice`)
静态页含合同条款、告知函状态、邮件草稿。本轮做**轻量版**:
- 受影响客户列表 = 影响 BOM 所属客户(本系统数据)+(有销售源时)未发货订单客户;
- 每客户一条告知记录:是否需告知(人工勾选;"合同条款"仅为自由文本备注,**不建合同模型**)、告知函状态(草稿/已发送/已回函,经既有 OutboundMessage/SMTP Provider;未配置 SMTP 则只能停在草稿,不伪造发送)、预计回函日期;
- 邮件草稿模板由租户配置(公司名/条款引用/签名),不硬编码"硬禾科技"。

## 9. 明确不做(T3,占位注明"待商务确认")
MES 同步指令(LOCK/RELEASE MBOM、更新 Feeder/AOI/ICT 程序)、流程引擎与模拟器、品质评审阶段、客户签章/回函自动解析、自动切换生产、7 节点动态评审模板。

---

## 10. 与 ERP Lab 的闭环验证
T2 面板在 F4 完成后以 ERP Lab 作为 ErpProvider 目标验证:NORMAL 场景数据齐全;`MATERIAL_NOT_FOUND` / `TIMEOUT` / `PARTIAL_RESPONSE` 场景下面板必须显示降级状态(部分数据源失败),不得整页失败或显示不完整数据而不提示。LAB-1 落地后补工单/销售订单两项。

## 11. 验收
- 五角色之外无任何审批角色出现;
- 所有状态转移写 AuditLog;VOIDED 可查;Release 快照冻结;Apply to BOM 二次确认且回链;
- Feature Flag 关闭时 T2/T3 区块不渲染不请求;
- 影响分析每项数据带来源与时间,缺源显空态;AI 建议不写入任何字段;
- Playwright:创建 ECN → 导入变更行 → 提交 → 工程通过 → 采购确认 → 管理批准 → 发布 → Apply to BOM(二次确认)→ 作废另一条并可查;开启 Flag 后影响面板在 Lab NORMAL/TIMEOUT 两场景下的表现。
