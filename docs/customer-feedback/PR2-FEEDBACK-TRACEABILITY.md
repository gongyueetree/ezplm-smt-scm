# PR2 反馈溯源矩阵(GAP MATRIX)

基线:`main` @ `e261564`(#38/#40 已合)
依据:`docs/AI PR2版本适用反馈.pdf` + **客户第二轮答复 `问题清单-reply120260811.pdf`**
建立:2026-08-11 · 更新:2026-08-11(第二轮)· 本文件是 PR2 反馈的**唯一验收台账**

> **第二轮更新说明**:客户 13 个问题**已全部答复**,状态见下方「客户答复确认表」。
> 原「本轮重点」里有 8 项已由 PR #39/#41/#42/#43/#44 关闭,
> 各小节顶部加了 `✅ 已关闭` 标记并注明 PR 号 —— **原始差距描述保留不删**,
> 那是当时判断的依据,删掉就没法回头核对我们有没有做对。

## 状态取值(不允许其它措辞)

| 值 | 含义 |
|---|---|
| `DONE` | 已实现且有测试证据,客户可直接验收 |
| `PARTIAL` | 部分实现,剩余差距已写明 |
| `MISSING` | 尚未实现 |
| `BLOCKED_BY_CUSTOMER` | 等客户提供定义/数据/决策 |
| `BLOCKED_BY_EXTERNAL_SYSTEM` | 等 ERP / SMTP / 汇率源等外部依赖 |

> 禁止「基本支持」「差不多完成」「后续可扩展」。

---

## 客户答复确认表(第二轮,`问题清单-reply120260811.pdf`)

全部 13 问已答。`CONFIRMED` = 客户给出明确结论,可据此实施。

| # | 问题 | 客户结论 | 状态 | 对实现的影响 |
|---|---|---|---|---|
| Q1 | Excess 来源 | **来自 ERP Excess Report**,必须引用进本系统 | `CONFIRMED` | 依赖 Q2 凭据 → `WAITING_FOR_CREDENTIALS` |
| Q2 | ERP 型号 | **金蝶 K3 云星空**;客户提供 API 文档与测试账号 | `CONFIRMED` | 状态 = `WAITING_FOR_CREDENTIALS / API_DOC`;**只做金蝶,不铺开用友/SAP/Oracle** |
| Q3 | 邮件通道 | 发送 = **公司 SMTP**;回执 = **已读回执** | `CONFIRMED` | 参数未到(O4);已读回执的技术限制待客户确认(O5) |
| Q4 | BOM 分家 | **两套 + 一键转换**;正式 BOM 必须关联客户编码;**优先匹配内部料号** | `CONFIRMED` | ✅ PR #42 已实现;匹配失败的处置仍待定(O7) |
| Q5 | 采购申请 | **归 PM** | `CONFIRMED` | ✅ PR #39 已实现 |
| Q6 | NRE | **PM 派工**;工程填完**直接回报价**;标准项客户后续提供;项目可选 + 备注 | `CONFIRMED` | ✅ PR #43 已实现;标准清单待提供(O6) |
| Q7 | 订单转化 | **人工标记中标** | `CONFIRMED` | ✅ PR #43 已实现 |
| Q8 | 汇率 | **来源 = ERP** | `CONFIRMED` | 不再找外部汇率 API;依赖 Q2 |
| Q9 | 批量导入 | 需要**物料替代**与**预 BOM**的批量导入/导出 | `CONFIRMED` | 两项均为新功能 → PR-E3 / PR-E4 |
| Q10 | 替代料 | **功能一致优先级最高**;还需「功能一致+封装一致」「功能一致+封装细微差异」 | `CONFIRMED` | 现有 5 种互斥模式不够 → PR-E2 三维模型 |
| Q11 | AR/AP | 功能没错,**是不知道入口与流程,需要举例** | `CONFIRMED` | 不重写引擎,只做可发现性 → PR-E5 |
| Q12 | 质量/追溯 | 质量事件归**品质**;当前缺品质模块;长期希望 **SN 级**(依赖 MES) | `CONFIRMED` | 最小品质模块 + SN-ready schema → PR-E6;MES 信息待提供(O9) |
| Q13 | RFQ/BOM 导入 | **Gerber 上传会死机**;**正常 BOM 导入 AI 会漏数据** | `CONFIRMED` | **P0 数据完整性/稳定性** → PR-E1a / PR-E1b |

---

## 第二轮已关闭清单 —— `DONE — NO CHANGE RECOMMENDED`

**这些不得重写。** 每条都有单测 + E2E,门禁在 main 上重跑过(99 files / 1367 tests,E2E 204 passed)。

| 能力 | PR | 关键代码 |
|---|---|---|
| PM 创建采购申请 + 角色归属 | [#39](https://github.com/gongyueetree/ezplm-smt-scm/pull/39) | `app/api/procurement/requests/route.ts`(角色门在 previewOnly 之后) |
| 建议采购量 / GTB 公式拆解 | #39 | `lib/domain/gtb.ts` `breakdown[]` |
| Excess 契约 + 跨客户禁止自动占用 | #39 | `lib/providers/excess/index.ts` `splitExcessByOwnership` |
| 缺料单驱动 + Call Material | [#41](https://github.com/gongyueetree/ezplm-smt-scm/pull/41) | `lib/domain/shortage-sheet.ts`、`/api/shortage/*` |
| PRE_QUOTE / PRODUCTION BOM + 一键转换 + 绑客户 | [#42](https://github.com/gongyueetree/ezplm-smt-scm/pull/42) | `lib/domain/bom-purpose.ts`(变异测试验证过不改原件) |
| PM 派工 NRE + 工程填完直接回报价 | [#43](https://github.com/gongyueetree/ezplm-smt-scm/pull/43) | `lib/domain/quote-tasks.ts`、`/api/quotes/[id]/nre` |
| Quote Outcome 人工标记 WON/LOST | #43 | `lib/domain/quote-outcome.ts` |
| 订单转化率与审批通过率口径分离 | #43 + [#44](https://github.com/gongyueetree/ezplm-smt-scm/pull/44) | `lib/domain/management-kpi.ts`(原口径正名为 `approvalPassRate`) |

---

## 一、已完成 —— `DONE — NO CHANGE RECOMMENDED`

**本轮不得重写这些。** 已逐个核对代码与测试存在性。

| ID | 客户要求 | 状态 | 代码证据 | Route | Test |
|---|---|---|---|---|---|
| `PR2-PM-04` | 导入 BOM 时间与实际不符 | `DONE` | `lib/format/datetime.ts`;全仓 28 处改为部署时区 | 全站 | `tests/unit/format-datetime.test.ts`(11)含防回退结构守卫 |
| `PR2-PROC-06-C` | 阶梯价按数量分行,不用分号 | `DONE` | `app/(app)/procurement/suppliers/forms.tsx` 每档一行 | `/procurement/suppliers` | `tests/e2e/backlog.spec.ts` D-2 两项 |
| `PR2-ENG-03` | BOM 对比界面没有输入口 | `DONE` | `app/(app)/bom/compare/version-picker.tsx`(两下拉 + 开始比对 + 互换);版本列表触顶如实提示 | `/bom/compare` | `tests/e2e/feedback-batch2.spec.ts` 两项 |
| `PR2-ENG-01` | 上传 BOM「未能识别必需列」 | `DONE` | `app/api/bom/import/route.ts` 返回 `missingFields`/`detectedFields`/`preview`;`wizard.tsx` 渲染 | `/bom/import` | `feedback-batch2.spec.ts`(断言不再出现「人工指定列映射」) |
| `PR2-PM-07` | 人工费率抬头不显示 DIP/SMT | `DONE` | `app/(app)/quotes/[versionId]/page.tsx` 抬头三项 + 人工细分脚注 | `/quotes/[id]` | `feedback-batch2.spec.ts`(同时断言细分仍可见) |
| `PR2-PM-08` | 报价单不知在哪生成 | `DONE` | 导出按钮移入「正式导出」卡片,去重复入口 | `/quotes/[id]` | `feedback-batch2.spec.ts` |
| `PR2-PROC-04-B` | DigiKey/Mouser 与线下报价窗口分开 | `DONE` | `sourcing-panel.tsx` 拆为 ①A/①B | `/procurement/rfq/[id]` | `feedback-batch3.spec.ts` |
| `PR2-PROC-11` | 缺料与齐料重复,齐套并入缺料 | `PARTIAL` | 列已并入 `/shortage`;`/kitting` 改重定向 | `/shortage` | `kitting-shortage.spec.ts`(重定向保参数 + 齐套率没丢) |
| `PR2-PROC-08-B` | OPO 显示供应商与 request date | `DONE` | `lib/server/repositories/opo.ts` 批量查名;查不到显示「未知供应商」不回落 id | `/suppliers/opo` | `feedback-batch3.spec.ts` |
| `PR2-PROC-03-A` | Pin to Pin 是否和封装重复 | `DONE` | `lib/domain/alternate-score.ts` MODE_LABELS 改写;页面明说二者不同 | `/materials/alternates` | `feedback-batch3.spec.ts` |
| `PR2-PROC-01-D` | 批量导入物料改 xls 附件 | `DONE` | `parsePartImportGrid` + `extractRows`;粘贴入口保留 | `/materials` | `n3-part-xls-import.spec.ts`(真 xlsx) |
| `PR2-PROC-06-B` | 供应商策略批量导入 | `DONE` | `lib/domain/supplier-offer-import.ts` + `/api/procurement/supplier-offers/bulk-import` | `/procurement/suppliers` | unit(11)+ e2e(3) |
| `PR2-PROC-06-A` | 策略是否应用到 PO | `DONE` | **本来就已应用**(`purchase-order.ts::loadPolicy`);已在页面写明 | `/procurement/suppliers` | `n9-supplier-offer-import.spec.ts` |
| `PR2-PROC-04-C/D` | 报价多次上传 / 可删除 | `DONE` | `SupplierQuote` 按批存;`DELETE /api/procurement/quotes/[id]` 需原因 + 删前审计摘要 + 已有结论拒删 | `/procurement/rfq/[id]` | `n5-compare-export.spec.ts` |
| `PR2-PROC-12`(部分) | 库存总览 PN / MFG&MPN / 客户筛选 | `DONE` | `/inventory` 补 PN、制造商、在途;客户+日期筛选本就有;修掉 `take:500` 静默截断 | `/inventory` | `n11-inventory.spec.ts` |
| `PR2-PROC-13` | 损耗报告多维度/多月/金额/STD | `DONE` | `groupScrapWithAmount` / `buildPeriodTrend`;`Part.standardCost` + 迁移 | `/scrap` | unit(13)+ e2e(3) |

---

## 二、本轮重点 —— 真正尚未闭环

### `PR2-PROC-05` 采购申请单主链(用户指令 A)

> ✅ **已关闭 —— #39**。以下差距描述是当时的判断依据,保留备查。

| 项 | 内容 |
|---|---|
| 客户要求 | 申请单应由 PM 递交或从 ERP 引用;不要只显示 GTB |
| **状态** | `PARTIAL` |
| 代码证据 | `app/api/procurement/requests/route.ts` **无任何角色校验**(仅 `requireSession`);`PurchaseRequest` 模型只有 `mpn/qty/gtbSnapshot/note/status`;页面仅 5 列:单号/MPN/申请数量/状态/创建时间 |
| Route | `/procurement/request` |
| API | `POST/GET /api/procurement/requests` |
| Data model | `PurchaseRequest`(缺 internalPn/mfg/customer/project/requiredDate/inventory/excess/openPo/eta/supplier/selectedBuyQty/approvedUnitPrice/currency) |
| Test | `tests/e2e/backlog.spec.ts` B1(仅覆盖 GTB 试算) |
| **剩余差距** | ①无角色归属(谁都能建)②客户点名的 13 个列全缺 ③页面主标签仍是「GTB」,客户明确问过这是什么 ④公式未拆解展示 ⑤Excess 项无数据源 |
| 需客户确认 | 是 —— 申请单归 PM 还是双方可建(OPEN-QUESTIONS Q8) |
| 外部依赖 | Excess 数据源(Q1);ERP 引用需 Q2 |
| 推荐 PR | **PR-A** |

### `PR2-PROC-05-D` / `PR2-PROC-12` Excess 建模(用户指令 B)

> ✅ **已关闭 —— #39(契约与模型部分;ERP 真实取数仍等 Q2 凭据)**。以下差距描述是当时的判断依据,保留备查。

| 项 | 内容 |
|---|---|
| 客户要求 | 提示哪些料可不买;库存显示 Excess |
| **状态** | `BLOCKED_BY_CUSTOMER` |
| 代码证据 | `ExcessSnapshot` / `ExcessLine` **均不存在**(已核 schema) |
| 剩余差距 | 全部 |
| 需客户确认 | **是 —— Q1 未答:excess 从 ERP 导出 / 人工上传 / 系统自算?** |
| 推荐 PR | **PR-A**(只做 Provider 接口 + 模型 + `Excess 数据源未配置` 空态,**不造数**) |

### `PR2-PROC-04-E` 比价快照归档(用户指令 C)

| 项 | 内容 |
|---|---|
| 客户要求 | 点击比价导出总表并**保存文档** |
| **状态** | `PARTIAL` |
| 代码证据 | `GET /api/procurement/rfq/[id]/compare-export` 生成两表 xlsx;**无服务端归档**,`ProcurementCompareSnapshot` 不存在 |
| 剩余差距 | 快照未落库;后续新报价上传会改变"当时的结论" |
| 需客户确认 | 保留期与可见范围(保存位置可自行决定) |
| 推荐 PR | **PR-C** |

### `PR2-PROC-01-C` 双币种与汇率(用户指令 D)

| **状态** | `BLOCKED_BY_EXTERNAL_SYSTEM` |
|---|---|
| 代码证据 | `FxRate*` 不存在;N-5 `compare-summary.ts` 已正确做到**异币种不混比** |
| 剩余差距 | `FxRateProvider` 接口 + 原始报价/换算参考价分离显示 |
| 需客户确认 | **Q11 未答:汇率源** |
| 推荐 PR | **PR-F**(接口 + `汇率数据源待配置`,**不硬编码、不从报价反推**) |

### `PR2-PROC-12` 需求聚合(用户指令 E)

| **状态** | `MISSING` |
|---|---|
| 代码证据 | `/inventory` 刻意未做「需求」并写明口径未定义(**该决定正确,保留**) |
| 剩余差距 | `MaterialDemandService` 聚合 + 下钻 |
| 需客户确认 | 需求来源优先级 |
| 推荐 PR | **PR-F** |

### `PR2-PROC-10` 缺料单驱动(用户指令 F)

> ✅ **已关闭 —— #41**。以下差距描述是当时的判断依据,保留备查。

| **状态** | `MISSING` |
|---|---|
| 代码证据 | `/shortage` 入参仍是 `v/boards/scrap`,调 `buildKittingReport` —— **仍是 BOM 推算,不是缺料单驱动** |
| 剩余差距 | `ShortageSheet`/`ShortageSheetLine` + Call Material + 状态机 |
| 外部依赖 | 发邮件需 SMTP(Q3);无 SMTP 时只能「待发送/草稿已生成」 |
| 推荐 PR | **PR-B** |

### `PR2-PROC-07` 供应商协同(用户指令 G)

| **状态** | `PARTIAL` |
|---|---|
| 代码证据 | `/suppliers/collab` 现为「邮件草稿 / 建档邀请 / 接单回执(人工登记)」;**不是**「已审批未发送 PO 队列」 |
| 剩余差距 | PO 发送台 + 多联系人分类(ORDER/RFQ/OPO/FINANCE/QUALITY)+ 发送记录字段 |
| 外部依赖 | SMTP(Q3);**无 SMTP 不得显示已发送** |
| 推荐 PR | **PR-E** |

### `PR2-PROC-08-A` OPO 回复来源(用户指令 H)

| **状态** | `PARTIAL` |
|---|---|
| 代码证据 | `OPOReply.replySource` 已存在并在 `actions.tsx:107` 显示;但手工录入硬编码 `"MANUAL"`,**枚举未规范**(要求 SUPPLIER_PORTAL/PROCUREMENT_MANUAL/EMAIL_IMPORT/ERP/API) |
| 剩余差距 | 枚举规范化 + 主表列显式展示 Requested ETA / Reply At / Last Reminder At |
| 推荐 PR | **PR-E** |

### `PR2-PM-03` / `PR2-ENG-02` 预 BOM 与正式 BOM(用户指令 I)

> ✅ **已关闭 —— #42(Q4 已 CONFIRMED;匹配失败处置仍待客户裁定 → O7)**。以下差距描述是当时的判断依据,保留备查。

| **状态** | `MISSING` |
|---|---|
| 代码证据 | `BOMPurpose` 不存在;BOM 无 PRE_QUOTE/PRODUCTION 区分 |
| 剩余差距 | 枚举 + 正式 BOM 强制绑客户编码 + 转换生成新版本(禁止原地转换) |
| 需客户确认 | **Q7 未答**;客户编码规则未定 |
| 推荐 PR | **PR-C** |

### `PR2-PM-06` 报价责任拆分 + NRE(用户指令 J/K)

> ✅ **已关闭 —— #43(Q6 已 CONFIRMED;NRE 标准清单待客户提供 → O6,字典可配置,代码不用改)**。以下差距描述是当时的判断依据,保留备查。

| **状态** | `MISSING` |
|---|---|
| 代码证据 | `QuoteComponentTask` 不存在;NRE **仅是成本分类枚举**(`quote-calc.ts`),没有工程流转 |
| 剩余差距 | Component Task(MATERIAL/NRE/LABOR/OTHER)+ 工程 NRE 填报 + 关键项完成才可审批 |
| 需客户确认 | **Q9 未答:NRE 含哪些项、谁派工、要不要审批** |
| 推荐 PR | **PR-D** |

### `PR2-PM-06` 订单转化率(用户指令 L)

> ✅ **已关闭 —— #43 + #44(Q7 已 CONFIRMED = 人工标记)**。以下差距描述是当时的判断依据,保留备查。

| **状态** | `PARTIAL` — **当前指标口径与客户要的不是一回事** |
|---|---|
| 代码证据 | `management-kpi.ts:55` `conversionRate = APPROVED / settled` —— 这是**审批通过率**,不是**转成订单率** |
| 剩余差距 | `QuoteOutcome`(OPEN/WON/LOST/EXPIRED)+ wonAt/customerOrderNo/markedBy;看板按客户/PM/日期筛选 |
| 需客户确认 | **Q10 未答:订单信息人工标记还是从 ERP 匹配** |
| 推荐 PR | **PR-D** |

### `PR2-PM-09` 批量报价 update(用户指令 M)

> ✅ **已核实 —— 无需改动**。`lib/server/repositories/quote-batch-update.ts` 的语义正是
> 「多个 BOM → 已有报价开新 Revision / 没有才新建」,与客户要的一致。**没有另造第二套。**

| **状态** | `PARTIAL` |
|---|---|
| 代码证据 | `QuoteBatchUpdateJob` 已存在 —— 需核实语义是否即「多个量产 BOM 批量 update」 |
| 剩余差距 | 语义澄清;**不得另造第二套** |
| 推荐 PR | **PR-D**(先核实再决定改名或补选择条件) |

### `PR2-PROC-09` AR/AP 对账(用户指令 N)

| **状态** | `PARTIAL` |
|---|---|
| 代码证据 | `recon-parse.ts` / `recon-match.ts` / `recon-aging.ts` 已有;判定为 一致/数量差异/单价差异/金额差异/币种不一致/仅对方有/仅我方有 —— **导入与匹配确实存在** |
| 剩余差距 | 匹配基准是**系统派生**,不是 ERP AR/AP;客户说"无法实现"需先查清卡在哪 |
| 需客户确认 | **Q15 未答:请客户提供一份实际对账单样表** |
| 外部依赖 | ERP AR/AP(Q2) |
| 推荐 PR | **PR-G** |

### `PR2-PM-10` 客户账号与客供料库存(用户指令 O)

| **状态** | `BLOCKED_BY_CUSTOMER` |
|---|---|
| 代码证据 | 无 CUSTOMER 角色;`RoleName` 五值;`data-scope` **已支持 CUSTOMER kind**(地基在) |
| 需客户确认 | **Q6 未答**;且账号创建方式未定 —— 在此之前**不得开放匿名客户注册** |
| 推荐 PR | **PR-H**(先 model + permission contract) |

### `PR2-PM-11` 追溯数据来源(用户指令 P)

| **状态** | `MISSING`(仅指 provenance 展示) |
|---|---|
| 代码证据 | `traceability/console.tsx` 无「数据来源」区域;置信度与截断提示已在(#22) |
| 剩余差距 | Data Provenance 区 + Quality Incident 来源枚举 |
| 需客户确认 | **Q16 未答:质量事件谁录** |
| 推荐 PR | **PR-I** |

### `PR2-MGMT-01` 三块看板(用户指令 Q)

| **状态** | `PARTIAL` |
|---|---|
| 代码证据 | 现有 6 个 KPI(报价总数/已批准金额/转化率/OPO 异常/呆滞/DC Aging);**无生产报表、无品质、无毛利率** |
| 剩余差距 | 生产(需数据源)+ 品质(汇总已有事件)+ 毛利率(从 Quote 快照派生) |
| 需客户确认 | **Q4 未答:品质是否本轮做** |
| 外部依赖 | 生产数据源(无 MES) |
| 推荐 PR | **PR-I** |

### `PR2-PM-01` Gerber 上传(用户指令 R)

| **状态** | `NEED_CUSTOMER_CONFIRMATION` |
|---|---|
| 代码证据 | `app/api/rfq/[id]/attachments/route.ts:12` `MAX_BYTES = 20MB`,超限拒绝。**未发现明显 UX/格式 bug** |
| 剩余差距 | 不明 —— 20MB 对 Gerber 压缩包通常够用 |
| 需客户确认 | **Q17 未答:请提供原始文件、大小、扩展名、失败截图**。不猜 |
| 推荐 PR | 暂不排 |

### `PR2-ENG-04` 批量导入入口(用户指令 S)

> ✅ **已关闭 —— #42(工程工作台已加显式 CTA;Q9 追加的两项批量导入导出属新功能 → PR-E3 / PR-E4)**。以下差距描述是当时的判断依据,保留备查。

| **状态** | `PARTIAL` |
|---|---|
| 代码证据 | `/bom/import` 在导航;物料页有「批量导入物料」按钮 —— **功能都在** |
| 剩余差距 | 工程工作台缺显式 CTA |
| 需客户确认 | **Q12 未答:客户找的是哪个** |
| 推荐 PR | 与 PR-C 合并(不新造 backend,复用 `/bom/import`) |

### `PR2-PROC-03-C` 网络补参数

| **状态** | `NEED_BUSINESS_AND_COMPLIANCE_CONFIRMATION` |
|---|---|
| 依据 | CLAUDE.md 约束 5 禁止爬虫;DigiKey/Mouser 条款同样禁止 |
| 本轮做法 | 设计 `ExternalSpecEvidenceProvider` 接口但**默认 Disabled**;启用后只作 Evidence(source URL / fetchedAt / confidence / unverified),**不覆盖 Part Master** |
| 需客户确认 | **Q5 未答** |

---

## 三、外部依赖总表(第二轮更新)

客户 13 问全部已答,**依赖不再是"问题没答"，而是"东西还没给"**。
详见 `OPEN-QUESTIONS.md` 的 O1–O11。

| 依赖 | 阻塞什么 | 编号 | 当前状态 |
|---|---|---|---|
| 金蝶 K3 云星空 API 文档 / 测试账号 | PR-E8 全部 | O1 | `WAITING_FOR_CREDENTIALS`;骨架已就位,无凭据时抛 `ErpNotConfiguredError` |
| Excess Report 字段与样表 | Excess 真实取数 | O2 | 契约已就位;未配置时**不扣减也不按 0 计** |
| 汇率字段与有效日期口径 | PR-E8 的 FX | O3 | 比价页**继续拒绝跨币种比大小**(正确行为,非缺陷) |
| SMTP 参数 | PR-E7 真实发信 | O4 | 全部邮件停在 `DRAFT`,代码里没有分支能写 SENT |
| 已读回执技术限制确认 | PR-E7 验收口径 | O5 | 三态分开存,不把 SENT 当 READ |
| NRE 标准项清单 | 不卡实现 | O6 | 字典**刻意不预置条目**;清单到位后录入即可 |
| 正式 BOM 匹配失败处置 | 一个分支 | O7 | 当前:允许转换 + 显式确认 + 标「待补内部料号」 |
| 品质是否需要独立角色 | PR-E6 | O8 | 推荐用权限,不动 Role 枚举 |
| MES 厂商 / SN 结构 | SN 级追溯 | O9 | 无 MES 则**无法实现**,不是排期问题 |
| BOM 丢数据样本 | 验证 P0 修复 | O10 | 已不等样本动手;但没样本无法证明客户那份不丢了 |
| Gerber 失败样例 | 确认 P0 根因 | O11 | 已定位嫌疑(formData 先缓冲后校验),待样本确认 |

---

## 四、第二轮新增差距(PR-E 批次)

依据客户第二轮答复 + 对 main @ `e261564` 的代码审计。

| ID | 要求 | 状态 | 代码证据 | 推荐 PR |
|---|---|---|---|---|
| `P0-BOM-INTEGRITY` | 正常 BOM 导入不得丢行 | `MISSING` | `lib/domain/bom-parse.ts::buildLines()` 有 **5 处 `continue` 无痕迹丢行**(空行 / 重复表头 / 续行合并 / `!hasKey` / `!hasIdentifier`);原始行数与输出行数**从未比对**;`RawBomRow` 表不存在 | **PR-E1a** |
| `P0-GERBER-UPLOAD` | Gerber 上传不得卡死 | `MISSING` | `app/api/rfq/[id]/attachments/route.ts`:`await req.formData()` **先把所有文件整个缓冲进内存,之后才检查 20MB 上限**;无 Content-Length 早拒、无进度、无取消/重试。客户端无 FileReader/base64(**不是前端读整包**) | **PR-E1b** |
| `ALT-COMPAT-MODEL` | 三维兼容 + 功能一致优先 | `PARTIAL` | `lib/domain/alternate-score.ts` 现为 **5 个互斥模式**(PIN_TO_PIN / PACKAGE_COMPATIBLE / FUNCTIONAL / DOMESTIC / LOW_COST),不是 Functional × Package × Pin 三维正交;排序未把功能一致置首;`PartAlternate` 只有 `grade` 一个字符串 | **PR-E2** |
| `ALT-BULK-IO` | 替代料批量导入/导出 | `MISSING` | `/materials/alternates` 只有 finder,**无任何导入导出入口** | **PR-E3** |
| `PREBOM-BULK-IO` | 预 BOM 批量导入/导出 | `PARTIAL` | 单文件导入在(`/bom/import`);**多文件各自建 BOM、批量导出均无** | **PR-E4** |
| `RECON-DISCOVERABILITY` | 对账入口与示例 | `MISSING` | `/reconciliation` 空状态只有「暂无对账单」;无步骤引导、无示例下载、无「加载示例」 | **PR-E5** |
| `QUALITY-MIN` | 最小品质模块 | `PARTIAL` | `QualityIncident` + `ContainmentAction` **模型已存在**;但无独立页面、无 `quality.*` 权限、无客诉/供应商问题分类 | **PR-E6** |
| `TRACE-SN-READY` | SN 级数据模型准备 | `MISSING` | 无 `SERIAL_NUMBER` 节点类型、无 `FinishedGoodsSerial`、无 `MesTraceProvider` | **PR-E6** |
| `SMTP-SEND` | 真实发信 + 回执语义 | `MISSING` | 无 nodemailer / `SmtpMailProvider`;只有 `EmailDraft`(注释明写「没有 SENT」);`OutboundMessage` 等四表不存在 | **PR-E7** |
| `ERP-KINGDEE` | K3 云星空 Adapter | `PARTIAL` | `lib/providers/erp/kingdee/index.ts` **已有 176 行骨架**:testConnection / getMetadata / pullMaterials / pullInventory / pullOpenPurchaseOrders / pullWorkOrders / pushPurchaseOrders / pushEtaUpdates / getJobStatus。**缺** `getOrganizations` / `pullExcessReport` / `pullExchangeRates` | **PR-E8** |
| `ERP-EXCESS-FX` | Excess 与汇率真实落库 | `BLOCKED_BY_EXTERNAL_SYSTEM` | 依赖 O1 凭据 | **PR-E8** |

### 实施顺序

`PR-E1a`(BOM 丢行)→ `PR-E1b`(Gerber)→ `PR-E2` → `PR-E3` → `PR-E4` → `PR-E5` → `PR-E6` → `PR-E7`(等 SMTP)→ `PR-E8`(等金蝶凭据)。

**先做 E1a**:丢行是数据正确性问题,下游是报价、采购、追溯全部。
