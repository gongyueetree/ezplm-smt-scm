# 客户反馈(BOM2BUY 测试)→ ezplm-smt-scm 影响分析

> 来源三份原件(已存入 [`docs/customer-feedback/bom2buy-2026-09-17/`](../customer-feedback/bom2buy-2026-09-17/)):
> `BOM系统需求优化整理表20260917.docx` · `附图.docx`(10 张界面截图)· `标准BOM 及询价单模版.xlsx`
>
> **关键前提**:这批反馈针对的是**前期版本 BOM2BUY**,不是本仓库(ezplm-smt-scm)。
> 因此每条都分别判断:① 客户要什么;② **本仓库**当前是什么状态(可能已满足、部分满足、或同样欠缺)。
> 不把 BOM2BUY 的缺陷直接记成本仓库的缺陷 —— 下表逐条给本仓库证据。
>
> 基线:`main` @ `9de0409`。配套:[REFACTOR_BACKLOG.md](REFACTOR_BACKLOG.md) · [MIGRATION_PLAN.md](MIGRATION_PLAN.md)

---

## 0. 四条最重要的结论

### 0.1 这批反馈**回答了 REF-0 的决策 2(R0-7)**

客户的产品自己给出了答案。询价单界面的说明文字(`附图` 图 5)写着:

> 向没有 API 的代理商、贸易商人工询价:生成文案 → 微信/邮件发出 → 录入回复。
> **回复会作为报价参与寻源竞争**,过期自动失效。

四条独立佐证:

| 出处 | 原文 | 含义 |
|---|---|---|
| F9 | "比价单支持导入**线下供应商价格进行对比**" | 线下价格必须可比 |
| F8 ① | "采购下载**物料报价总表**,提交审核人" | 所有渠道汇成**一张**总表 |
| F5 | "无 MPN、无价格的物料条目需要保留,**供采购后续补充料号与价格**" | 后补价格必须计入 |
| D1 | Mouser HTTP 400 / Iceasy IP 未加白 / DigiKey 未收录 | API 不可靠 → **线下价格是必须能用的兜底,不是边缘场景** |

**结论:线下 / 人工录入的报价必须与 API 报价同权参与比价。** 决策详见 §3。

### 0.2 "物料重复"的根因看清了,本仓库有**同类且方向相反**的风险

客户在 F9 与第四节抱怨"直接生成采购订单会出现物料重复"。
`附图` 图 5 的勾选列表把根因显示得很清楚 —— `#46 #47 #48 #49 #50 #51 #52`
**七行都是同一个 MPN `SMA-KFD1011 ×300`**。

原因是 BOM **按位号逐行**存储(标准模板里 `R9 / R11 / R13 / R15` 四行同为 `GRM188R71H104KA93D`),
而询价单 / 采购单直接照搬 BOM 行,没有按 MPN 聚合。正确语义是**分层**的:

| 环节 | 粒度 | 理由 |
|---|---|---|
| 标准 BOM / 客户报价单 | **逐位号行保留** | 客户要按自己的 BOM 核对(F1),模板本身就是逐位号 |
| 询价单 / 采购比价单 / 采购订单 | **按 (MPN, 制造商) 聚合,数量合并** | 一次询一个料,不是询七次 |
| 多 BOM 对比 / BOM Matrix | **跨 BOM 按料号聚合** | F8 ③ "识别并合并共用物料" |

**本仓库的确证风险(两处,方向相反)**:

1. **该合的没合**:`replaceLines` 删后重建采购行,**无 MPN 唯一性检查**
   ([purchase-order.ts:131-190](../../lib/server/repositories/purchase-order.ts));
   `parsePoBulkText` **无重复检测**([po-bulk-input.ts](../../lib/domain/po-bulk-input.ts))
   —— 对比之下 [supplier-offer-import.ts:155-160](../../lib/domain/supplier-offer-import.ts) 对重复阶梯价**是会报错的**。
   即客户抱怨的"直接生成采购订单出现物料重复",**本仓库同样无守卫**。
2. **不该合的会合**:去重键只有归一 MPN、**不含制造商**(三份实现:
   [alternate-search.ts:133](../../lib/server/repositories/alternate-search.ts)、
   [part-detail.ts:286](../../lib/server/repositories/part-detail.ts)、
   [bom-match.ts:371](../../lib/domain/bom-match.ts),见 DUPLICATION_MATRIX §D8)。
   聚合时若沿用此键,同一 MPN 的两个制造商会被并成一个。

⚠️ 所以 **R1-15(聚合粒度分层)必须排在 REF-1 之后** —— 先有 Canonical Identity,才能用正确的键做聚合。

### 0.3 有一类 BOM2BUY 缺陷,本仓库**确实已免疫** —— 不要当成待办

| BOM2BUY 缺陷 | 本仓库 | 证据 |
|---|---|---|
| `Unexpected token 'A' … is not valid JSON` | **已免疫** | [http-client.ts:136-157](../../lib/providers/common/http-client.ts):先判 `!res.ok` 抛 `ProviderError`,再 `res.json().catch()` → "响应非 JSON" |
| 供应商接口异常被吞掉 / 静默空表 | **已免疫,且做得好** | `ProviderError` 带 provider/kind/status/retriable,`toSafeJSON()` **排除 cause 防密钥泄漏**;`redactUrl` 掩码 query 中的 apikey(**正对 Mouser 把 key 放 query 的情况**);400/403 立即非重试抛出;`runSourcing` 逐 provider catch 进 `degraded` 而非返回空([procurement.ts:146-152](../../lib/server/repositories/procurement.ts));UI 有降级横幅([sourcing-panel.tsx:329-338](../../app/(app)/procurement/rfq/[id]/sourcing-panel.tsx));**"未收录"与"报错"是两个不同展示态**,Mock 标「示例数据」 |

### 0.4 ⚠️ **更正我在 REF-0 中的乐观判断:零价格缺陷本仓库并未免疫**

客户截图(`附图` 图 10)有一行 `HS1MB · 400 · $0.0000 · $0.00` **被计入合计**。
我起初认为本仓库有 CLAUDE.md B5 纪律("绝不按 0 落库")因而免疫 —— **这个判断是错的**。
逐路径核查结果:**4 条路径里只有 1 条真正拦住 0**。

| 路径 | 是否拦 0 | 证据 |
|---|---|---|
| 供应商报价**文件上传**(正对客户截图场景) | ✅ 拦 | [supplier-quote-parse.ts:124-125](../../lib/domain/supplier-quote-parse.ts):`if (Number(unitPrice) <= 0) skipped.push(…)` |
| 供应商 **offer 批量导入** | ❌ **0 通过** | [supplier-offer-import.ts:126-129](../../lib/domain/supplier-offer-import.ts):判的是 `< 0`,`0` 合法 → 0 价阶梯进 `PriceBreak` → 进价格池 |
| **价格池** `usablePrices` | ❌ 无零值检查 | [price-pool.ts:82-114](../../lib/domain/price-pool.ts):只排除 REJECTED/EXPIRED/BLOCKED/INVALID_CURRENCY/QTY_NOT_APPLICABLE;`priceRange` 用裸 `Number()` 比较 → **0 会被选成最低价** |
| **比价总表** | ❌ 计为真实报价 | [compare-summary.ts:79](../../lib/domain/compare-summary.ts):`toDec("0")` 返回 `Decimal(0)` 而非 null → 0 价成为 `lowest` 进导出 |
| 异常阈值 | ❌ 不覆盖 | [procurement-flags.ts:66-71](../../lib/domain/procurement-flags.ts):只 flag `price > limit` |
| 报价**提交完整性门禁** | ❌ 被绕过 | [quote.ts:407-417](../../lib/server/repositories/quote.ts):`l.purchaseCost !== null` 即视为已覆盖 —— 存了 `0.000000` **照样通过提交门禁** |

**即客户截图里那个缺陷,经"线下 offer 导入"路径在本仓库同样会发生。**
这正是 REF-0 反复点名的模式:**规则写了,但只接上了一条路径**(同 `assertTenantScopedMutation` 零调用、
`allowedCurrencies` 每个调用方都省略)。→ 新增 **R0-8**,P0,在 REF-0.5 修。

---

## 1. 标准 BOM / 客户报价单模板 —— 导出契约

`标准BOM 及询价单模版.xlsx` 单 sheet「客户报价单」,**26 列**。这是客户要的**交付物格式**,应固化为导出契约 + golden 夹具。

**表头区(r1–r8)**:项目 · 生产数量 · 报价有效期至 · 交期说明 · 待贵司确认的替代料 · 风险备注
**表尾**:`合计` + `单板报价`(= 合计 ÷ 生产数量)

| 列 | 字段 | 本仓库现状 |
|---|---|---|
| 1–8 | # · 客户料号 · 内部料号(匹配后) · 描述 · 位号 · 用量 · MFG · MPN | ✅ `BOMLine` 全有,三层身份已分列 |
| **9–13** | **报价数量 · 需求数量 · 单价(报价) · 单价(调整后报价) · 小计** | ⚠️ 见下 |
| **14–18** | **同上五列第二组** | ❌ **多数量档报价,当前模型不支持** |
| 19–21 | MOQ · SPQ · LEAD TIME | ❌ `QuoteLine` 无(在 `SupplierOffer` 上) |
| 22 | 供应商 | ❌ `QuoteLine` 无 |
| 23–26 | 备注 · 备注2 · 备注3 · 备注4 | ⚠️ `QuoteLine.note` 仅一个 |

**三条硬结论**:

1. `QuoteLine` 只有一个 `qty`([schema.prisma:1921](../../prisma/schema.prisma)),**无"需求/报价"双数量**,
   也**无第二组数量场景**。模板要"同一份 BOM 按两个生产数量各报一次" —— 这是 `QuoteVersion` 级的**多数量档**,当前缺位。
2. **F10 是展示规则不是存储问题**:`purchaseCost`/`customerPrice`/`finalUnitPrice` 均 `Decimal(18,6)`,存储够用;
   缺的是格式化 —— 且 [quote-calc.ts:247,274-277](../../lib/domain/quote-calc.ts) 把**同一个 `decimals`(默认 2)
   同时用于单价与小计**,5 个调用方全部省略该参数 → 处处 2 位。`lib/format/` 下**只有 `datetime.ts`,没有金额格式化器**。
3. **F11 的落点已经存在,缺的是 UI**:`QuoteLine.customerPrice` 注释即「实际客户报价价格(单价,人工可调)」
   ([schema.prisma:1929](../../prisma/schema.prisma)),覆盖语义已实现
   (`const effective = overridden ? dec(l.customerPrice) : finalUnitPrice`,[quote-calc.ts:259-261](../../lib/domain/quote-calc.ts)),
   API 也接受它 —— 但**编辑器 11 列里没有这一列,全仓 `.tsx` 中 `customerPrice` 只出现一次且只读**。

---

## 2. 逐条需求 → 本仓库状态 → 落点

> **已满足** = 模型+逻辑+API+UI 全通;**部分** = 有底座缺一环;**欠缺** = 无。

### 2.1 待澄清问题 Q1–Q6 —— 需要**你/客户**答复,不是工程问题

| # | 问题 | 本仓库相关事实 | 建议答复口径 |
|---|---|---|---|
| Q1 | BOM 最大行数? | 已有 15MB / 17,000 行 E2E(`zz-e9`);>50 唯一 MPN 强制 ImportJob 分批 | 可给**有实测依据**的承诺值 |
| Q2 | 是否需要注册? | 自助注册与管理员开通两条路都在 | 商务决定 |
| Q3 | 人工分类 / NRE 独立界面? | NRE 已有独立模型与接口;分类确认在报价编辑器内逐行 | 与 F12 一并设计 |
| Q4 | 「审核与冻结」定义? | **本仓库已有成熟定义**:DRAFT→PENDING_APPROVAL→APPROVED,提交存 `submittedSnapshot`、通过存 `approvedSnapshot`,PENDING/APPROVED 参数全冻结,PDF/导出只用快照 | **直接用本仓库的定义答复** |
| Q5 | 五个按钮用途? | 均为 BOM2BUY 的按钮,本仓库无对应实现 | 逐个确认是否纳入本期;「AI 生成客户风险说明」须走 CLAUDE.md 约束 3 人工确认 |
| Q6 | 报价数量为何≠要求数量? | 见 §2.4 D2 | **根因已定位** |

### 2.2 流程调整 —— 两个实质变化(不只是换顺序)

1. **「审核与冻结」从独立环节变成匹配环节内的强制关口**:
   "禁止直接向 Digikey、Mouser 发起询价,BOM 必须完成人工核对;核对无误后由审核人流转至采购"。
   本仓库已有逐行确认与批量确认([bom-detail.ts:211](../../lib/server/repositories/bom-detail.ts)),
   但**没有"核对未完成即禁止对外询价"的守卫** → **R1-16**。
2. **"一个一个确认非常耗时,需要将匹配程度提高到 95+%"** —— 这是匹配率问题不是 UI 问题,
   直接支持 **P0-1 必须先修**:521 条 MFG 映射静默失配正在压低匹配率。

### 2.3 功能增强 F1–F13

| # | 需求 | 状态 | 本仓库证据 / 缺口 | 落点 |
|---|---|---|---|---|
| F1 | Sheet1 留原始 BOM + 遗漏二次校验 | **部分** | **对账半边是全仓最好的实现**:每行有 `RawBomRow` + disposition + 人读原因,与 BOMLine 同事务写入,恒等式 `totalRows = recognized+merged+nonBusiness+needsReview` 断言,导入页有账平/对不上账横幅。**缺**:4 个导出全是系统归一后的,`prisma.rawBomRow` **只在导入页被读过一次,从不进导出** | REF-2 |
| F2 | 报价数量 = 需求 + 损耗 | **部分(采购侧有,报价侧无)** | 采购侧完整:`calculateGtb` 实现 `ceil(需求×(1+损耗))`,`PurchaseRequest` 有 `demandQty` 与 `qty` 两列,页面三列并列。**报价侧**:`QuoteLine` 只有 `qty`;`generateQuoteLinesFromBom` 直接 `qty: String(l.qty)` 照抄,不加损耗。**损耗率全局不可配**:`DEFAULT_SCRAP_RATE="0"`、`scrapRateConfirmed` 硬编 `false`,唯一入口是 GTB 试算器的自由文本框 | REF-3 + schema 增量 |
| F3 | 匹配页 MFG 独立列 | **欠缺(UI)** | 匹配页 5 列,厂商是与封装拼在一起的灰色小字 `{manufacturer} · {packageCode}`([review.tsx:314-316](../../app/(app)/bom/version/[versionId]/review.tsx));数据层早有 | 小改 |
| F4 | 无 MPN 物料保留在标准 BOM | **已满足** | `REQUIRED_FIELDS=["qty"]` 且注释说明强制 MPN 会 422 拒掉 KiCad/Altium 导出;无标识行不伪造成行,记 `NO_IDENTIFIER`/`INSUFFICIENT` 并在 UI 呈现 | — |
| F5 | 匹配/报价后仍保留无 MPN 物料 | **欠缺(两处硬丢)** | ① `quote-from-bom.ts:34` 过滤掉 `decision === "NO_MATCH"` 的行 —— **正是需要采购补全的那些行,永远不会变成 QuoteLine**,且返回的 note 只统计缺成本行,**不告诉用户丢了几行**;② `sourcing/route.ts:40` `filter(l => l.mpn)`,进度按 `targets.length` 计算 —— 无 MPN 行**连分母都被抹掉**。无"待采购补全"状态位 | **REF-3(优先)** |
| F6 | CNY 优先,USD 辅助 | **部分,且语义不符** | 无偏好/排序规则,只有**硬编码基准币种** `currency: "CNY"`([sourcing/route.ts:79](../../app/api/procurement/rfq/[id]/sourcing/route.ts))。USD 报价不是"辅助展示"而是被标 `currency_mismatch` **踢出排名集**;比价汇总里币种按**字母序**排([compare-summary.ts:82](../../lib/domain/compare-summary.ts))。客户要的"辅助展示"当前做不到 | REF-3;FX 口径仍 BLOCKED(O3) |
| F7 | 询价单选整份 BOM + 区分源 BOM | **部分** | **创建已满足**:表单是 BOM 版本多选,`bomVersionIds` Json 持久化,按 `[bomVersionId, lineNo]` 排序取行。**溯源只到数据层**:`SupplierQuoteLine.bomLineId` 在,但 RFQ 详情投影、寻源表格列、比价导出**都没有 BOM 列**;schema 自己标注了反查弱点(依赖 jsonb 包含查询) | REF-3(补展示) |
| F8 | 多 BOM 对比三用途 | **②满足 / ①部分 / ③无 UI** | ② `compareBomVersions` 按展开位号为键、MPN 兜底,支持跨版本对比、落 `BomCompareRun`、CSV 导出共用同一 diff 函数 ✅;① `buildCompareSummary` 是**按 RFQ 内跨供应商**比价,不是跨 BOM 的报价总表,**无数量列无小计**;③ `buildCostMatrix` **严格单版本**,无跨 BOM 汇总,且**全仓没有任何 .tsx 消费它** | REF-5 |
| F9 | 比价单≠PO + 线下价 + PM 申请单 + 完整明细 | **部分** | **比价单已是独立概念** ✅:`ProcurementRFQ` 即比价单(导出路由就叫比价单),有逐行选择与"全部异常行解决才能提交 PM"的门禁;**线下价导入 ✅** 且写入时冻结 `wasFlagged`;**PR→PO 未接通** ❌:`PurchaseRequest` 是**一单一 MPN**,`createPurchaseOrder` 收下 `purchaseRequestId` 但**从不读取 PR 内容填行**;**PO 重复无守卫** ❌(见 §0.2) | **REF-0.5(R0-7)+ REF-3** |
| F10 | 单价 4 位 / 成本 2 位 / 四舍五入 | **部分** | 舍入模式正确(`ROUND_HALF_UP`);但单一 `decimals` 默认 2 同时套用单价与小计,5 个调用方全省略;无金额格式化器 | REF-3 |
| F11 | 「调整后单价」栏位 | **部分:模型+逻辑+API 齐,UI 缺** | 见 §1 第 3 条 | REF-3 |
| F12 | 毛利独立界面 | **已满足** | `computeGrossMargin` 只在管理看板 KPI 渲染;`app/(app)/quotes/**` 下 grep 毛利/margin **零命中**;门户 DTO 亦按类型排除毛利 | — |
| F13 | 批量导入 PO / 申请单传递 | **部分** | 批量粘贴做得好:同义词表头识别、逐行错误带行号、**"不猜、不填 0"**;**"由申请单传递"未实现** ❌ | REF-3 |

### 2.4 系统问题 D1–D3

| # | BOM2BUY 现象 | 本仓库 |
|---|---|---|
| D1 | 大量物料无法匹配;Mouser 400 / IP 未加白 / 未收录 | **异常处理已满足**(§0.3)。但**匹配率是本仓库的真问题** —— P0-1 令 521 条真实 MFG 映射静默失配,正对应客户"匹配程度提高到 95+%" |
| D2 | 报价数量 ≠ 需求数量 | **同类机制在本仓库存在,但是有意设计且已显示**。取价函数本身是保守的:`getApplicablePriceBreak` **只向下取所满足的最大档,绝不向上够档**,低于最低档返回 `null`(→ `no_price_break`,不是 0 也不是最近价)([offers.ts:27-37](../../lib/domain/offers.ts))。分歧在下一步:`purchaseQty = calculateRoundedPurchaseQty(demandQty,{moq,spq})`,随后**按放大后的 `purchaseQty` 取价与算总价** —— 需求 800、MOQ 1000 就按 1000 报。UI **有如实并列显示**需求与 `purchaseQty`,`price-pool` 更把口径显式化为 `SELECTED_BUY_QTY/SUGGESTED_BUY_QTY/DEMAND_QTY` 并持久化。**但比价导出没有数量列**,放大后的数量**在导出文件里不可见** —— 客户拿到的正是导出文件 | 见 §4 新增 R1-17 |
| D3 | 多 BOM 对比无法上传 | 本仓库走已入库版本,形态不同;F8 三用途另行落地 |

---

## 3. 决策:R0-7 —— 线下报价必须同权参与比价

| 方案 | 做法 | 判断 |
|---|---|---|
| **A(采纳)** | `SupplierOffer` + `PriceBreak` 为**唯一可比价真源**;`SupplierQuote`/`SupplierQuoteLine` 降级为**收到的报价单据**(凭证与溯源);录入时经同一 mapper 同时生成 offer | ✅ 满足 F9/F8①/F5;保留单据溯源;**仓内已有先例** |
| B | 价格池同时读两张表 | ❌ 固化两套模型;阶梯语义无法统一;比价/成本矩阵/报价总表/历史价每个读侧都要写两遍 |
| C | 废弃 `SupplierQuote` | ❌ 丢失"谁、何时、哪份文件"的溯源,违反审计纪律 |

### A 有现成先例,不是新设计

公开报价链接路径([supplier-action.ts:650-670](../../lib/server/repositories/supplier-action.ts))**已经**这么做:

```ts
// 落既有 SupplierOffer + PriceBreak(provider="OFFLINE" 线下报价池)。
// 这是**原始报价数据**,不做任何自动选择 —— 正式比价/选择仍走采购人工流程
provider: "OFFLINE", supplierId, mpn, currency, moq, spq, leadTimeDays, validUntil …
priceBreak: { minQty: l.moq ?? "1", unitPrice: l.unitPrice }
```

单一价格用 `minQty = moq ?? 1` 表示成一档阶梯 —— 语义自洽,无需新模型。
**要做的只是让其余录入通道走同一条路。**

### 配套约束(写进 REF-3 验收)

1. `provider="OFFLINE"` 与 API 来源**数据上同权**,但比价 UI 必须**如实标注来源与报价时间**(诚实 UI);
2. 线下报价**必有 `validUntil`**,过期自动失效(客户产品已是此语义);
3. 仍是**原始报价数据,不做自动选择** —— 供应商选择永远人工确认(CLAUDE.md 约束 3);
4. `SupplierQuote` 保留为单据,**与生成的 offer 双向可追**;
5. **合并时必须先过 R0-8 的零价守卫** —— 否则等于把 0 价直接放进价格池。

---

## 4. 对 REF-0 结论的修订

| 项 | 修订 |
|---|---|
| **决策 2(R0-7)** | **已决:方案 A**(§3),移出待商务池,进 REF-3;REF-0.5 先补"线下价格能进价格池"的失败用例(先红) |
| **P0-1 优先级** | **升为最高**。客户明确要求"匹配率 95+%",521 条映射静默失配直接压低匹配率 —— 从正确性问题升级为**验收阻塞项** |
| **新增 R0-8(P0)** | **零价格在 4 条路径中只有 1 条拦住**,且存了 `0.000000` 能通过报价提交完整性门禁(§0.4)。客户截图里的缺陷经"线下 offer 导入"路径在本仓库同样会发生 → REF-0.5 修 |
| **新增 R1-15(P1)** | **聚合粒度分层**(标准 BOM 逐位号 / 询价采购按 MPN+制造商聚合 / 多 BOM 跨 BOM 聚合);**必须排在 REF-1 之后**,否则会沿用不含制造商的错键 → REF-5 |
| **新增 R1-16(P1)** | **BOM 核对未完成禁止对外询价**的守卫(流程调整第 1 条)→ REF-3 |
| **新增 R1-17(P1)** | **比价导出补数量列**:`purchaseQty` 与 `demandQty` 在 UI 上并列显示了,**但导出文件里没有数量列** —— 客户看到的正是导出文件,这就是 D2 观感的直接来源 → REF-3 |
| **新增 R1-18(P1)** | **无 MPN / 无匹配行在报价与寻源中被硬丢**(F5),且**不告知丢了几行**,寻源进度连分母都抹掉 —— 与"账本不允许静默丢行"的既有纪律自相矛盾 → REF-3 |
| **新增 R2-13(P2)** | 标准 BOM / 客户报价单 **26 列导出契约**固化为 golden 夹具 → REF-2 |
| **新增 R2-14(P2)** | **损耗率不可配**(`DEFAULT_SCRAP_RATE="0"`,`scrapRateConfirmed` 硬编 false,唯一入口是试算器文本框)—— F2 要求"按损耗规则自动算",需要租户/客户/品类级规则 → REF-3 |
| **Q1–Q6** | 属业务澄清,不进工程 backlog;Q4 建议**直接采用本仓库既有报价状态机定义**答复 |

---

## 5. 隐私处理说明

三份原件按 CLAUDE.md《权威文档》既定做法存入 `docs/customer-feedback/`
(该目录既有 docx/xlsx/pdf 原件先例,仓库为私有仓库)。
内容是客户对**我方产品**的需求与界面截图,**不含**乾创 ERP 的真实采购关系或客户/供应商对照表,
与 R4 §4 所禁止的"原始 ERP 导出 / 真实采购关系"不是一类。
本文引用截图时只描述界面行为与数字量级,未复制任何客户业务数据表。
