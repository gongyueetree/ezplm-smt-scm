# REFACTOR BACKLOG — REF-0

> 基线:`main` @ `9de0409`。每项含 ID / Priority / Problem / Files / Risk / Target / Migration / Tests / Acceptance。
> **Risk** 指"做这件事的风险",不是"不做的风险"。
> P0 = 正确性(已产生或将产生错误业务结果)· P1 = 架构性重复 · P2 = 可维护性 · P3 = 清理。

**统计:P0 × 8 · P1 × 18 · P2 × 14 · P3 × 9 = 49 项。**

> 2026-09-17 增补 7 项(R0-8 / R1-15…R1-18 / R2-13 / R2-14),来源为客户对前期版本 BOM2BUY 的测试反馈,
> 逐条对本仓库核实后得出 —— 分析见 [CUSTOMER_FEEDBACK_2026-09-17.md](CUSTOMER_FEEDBACK_2026-09-17.md)。

---

# P0 — Correctness

## R0-1 · MFG 映射键规则不一致导致静默失配

- **Priority**: P0(线上生效,影响真实客户数据)
- **Problem**: 写入侧 `manufacturerPartNoKey` 用 CJK 保留规则 `[^\p{L}\p{N}]`,BOM 匹配查询侧用 ASCII 规则 `[^0-9A-Z]`。含非 ASCII 的 MFG_PN 永远查不出映射,`QC_MFG_MFR_MPN`/`QC_MFG_MPN` 通道静默返回空,**无错误、无降级、无提示**。第二重错配:Map 以库值(CJK)为键,`bom-match` 以 ASCII 键取值。
- **实测影响**:乾创真实数据 MFG 维护单 52,256 条中 **510 条**(1.0%)、采购订单 458 条中 **11 条**(2.4%)含非 ASCII → **521 条映射当前不可达**。
- **Files**: `lib/server/repositories/bom-import.ts:273,281-285,364` · `lib/domain/bom-match.ts:169-171,288` · `lib/providers/common/mpn.ts:9` · `lib/domain/part-mfg.ts:22-29` · `prisma/migrations/…r4_3_key_recompute/migration.sql`
- **Risk**: 低。改查询侧归一函数即可,**不动库内数据**(r4_3 已把库内统一为 CJK 保留)。风险点是 `bom-match` 的 `keyOf` 被其它通道共用,改它会影响 ezPLM/分销商匹配的键 → 应只改 MFG 通道的键函数,不动 `normalizeMpn`。
- **Target**: `buildMatchContext` 与 `bom-match` 的 MFG 通道统一使用 `mfgPartNoKey`(`lib/domain/part-mfg.ts`),与写入侧、SQL 三方一致。
- **Migration**: 无 schema 变更。
- **Tests**: ① 单测:`mfgByMpnKey` 用含中文的 MFG_PN 构造,断言命中(当前全部用 ASCII,故逃逸);② 单测:`mfgPartNoKey` 与 PG `regexp_replace(upper(x),'[^[:alnum:]]','','g')` 在同一组样本上逐一等价;③ UAT:对真实夹具断言 521 条非 ASCII 映射可命中。
- **Acceptance**: 三套规则(TS 写入 / TS 查询 / SQL)由一条参数化单测同时锁定;含 CJK 的 MFG_PN 端到端可匹配;`pnpm test:uat:qianchuang` 通过。

## R0-2 · 参数比较只比数值不比量纲

- **Priority**: P0
- **Problem**: `compareParam` 的数值分支只读 `.number`,**从不比较 `.unit`** —— `72 MHz` 与 `72 MB` 都解析为 `72e6`,判为"一致 / 100 分"。`ParsedParam.unit` 的注释自称"用于同量纲校验",但无任何调用点读取它。附带:`mΩ`/`Ω` 不在单位字符类 `[a-zA-Zµμ%°]` 中,`"100 mΩ"` 解析失败落入文本分支,变成"字符串相等 → 100 / 否则 0"。
- **Files**: `lib/domain/param-compare.ts:25,57-75,171-187,208-212`
- **Risk**: 中。加上量纲校验会让**一部分当前判"一致"的比对变成"不可比"** → 替代料评分会下降。这是修正而非回归,但必须走 golden diff 并人工批准差异。
- **Target**: 引入 `QuantityIR`(dim + canonicalValue),`comparable(a,b)` 要求 `dim` 相同,否则拒绝数值比较并落回文本比较。参考 altpart-pro `api/_lib/quantity.js` 的 16 维表与 `comparable()` 语义(**只采规则,TS + Zod 重写**)。
- **Migration**: 无 schema。若 `AlternateSelection` 存了历史分数快照,快照不重算(保持历史可复现)。
- **Tests**: `72 MHz == 72000000 Hz` → 100;`72 MHz` vs `72 MB` → **不可比**;`3.3 V == 3300 mV`;`10 kΩ == 10000 Ω`;`100 nF == 0.1 µF`;`64 KB = 64000` 而 `64 KiB = 65536` 且两者不等;`V` vs `A` 不可比;`parseUnit("widgets") === null`;`mΩ` 可解析。
- **Acceptance**: 上述用例全绿;对全量替代料夹具跑 old-vs-new 对拍,每一条分数变化都能归因到"量纲修正"并经人工批准。

## R0-3 · 替代料候选只填封装一项参数

- **Priority**: P0
- **Problem**: `valuesFrom()` 对每个约束只在 `key === "package"` 时填值,其余一律 `null`。因此 LOCAL 与 DIGIKEY 来源的候选:`technical` 恒等于封装单项得分,`evidence` 恒等于封装约束的权重占比,其余参数恒记"缺失"。只有 ezPLM(`searchPartsWithParameters`)来源能拿到真实参数。UI 上四维分数看起来是算过的,实际只有一维。
- **Files**: `lib/server/repositories/alternate-search.ts:141-153,169-178,222-228,244-249`
- **Risk**: 中。填上真实参数后分数会**全面变化**;`void source.description` 说明当初是有意留空(描述未解析)。需先确认数据来源:本地 `PartAttributeValue`、DigiKey `Parameters`。
- **Target**: 单一 `buildCandidateSpec()`,三个来源共用;参数值从各自来源真实提取(本地走 `PartAttributeValue`,DigiKey 走归一后的参数),无法提取的**显式标 `known:false`** 而非静默 null。
- **Migration**: 无。
- **Tests**: 每个来源各一条用例,断言 `rows` 中非封装参数有非 null 分数;断言 `evidenceCoverage` 随参数数量变化;断言无参数来源时 `evidence` 低而非 `technical` 高。
- **Acceptance**: 三来源候选的 `evidence` 分布不再退化为常数;golden 对拍差异全部可归因。

## R0-4 · Agent 审批写入抹掉未提供字段

- **Priority**: P0(数据丢失)
- **Problem**: 审批路由只传 `{lineNo, category, materialCategory, markupPct}`,而 `upsertQuoteLine` 的 update 分支用 `input.x ?? null` 装配 `data` 后 `updateMany` → **批准一条 AI 分类建议会把该报价行的 `qty`、`purchaseCost`、`customerPrice`、`quotedMfg`、`quotedMpn`、`altMfg`、`altMpn`、`note` 全部置 null**,包括 markup 本该乘的 `purchaseCost`。审批循环还非事务、非幂等:`AgentApproval.status` 先翻成 APPROVED,后续行写失败无回滚。
- **Files**: `app/api/agent-approvals/[approvalId]/route.ts:44-57` · `lib/server/repositories/quote.ts:176-189,216-236` · `lib/server/repositories/agent-run.ts:108-122`
- **Risk**: 低(当前**无 UI 可达该端点**,见 R0-6,故线上未必已发生)。修复方式是给 `upsertQuoteLine` 加"部分更新"语义或新增 `patchQuoteLine`,不改既有全量 upsert 调用方。
- **Target**: 审批只做**字段级 patch**;整个审批循环进单事务;失败则 `AgentApproval` 保持 PENDING。
- **Migration**: 无。
- **Tests**: 建含完整字段的报价行 → 批准一条只带 `materialCategory`/`markupPct` 的提案 → 断言 `qty`/`purchaseCost`/`customerPrice`/MPN/备注**未变**;断言中途失败时 approval 仍为 PENDING;断言重复批准被拒。
- **Acceptance**: 上述回归用例常驻;`decideAgentApproval` 与审批路由首次获得测试覆盖。

## R0-5 · `assertTenantScopedMutation` 在生产路径零调用

- **Priority**: P0(纪律失效 —— CLAUDE.md 明文要求)
- **Problem**: 守卫函数已实现,但 `app/`、`lib/`、`scripts/` 中**零调用**,只有两个测试文件引用它。246 处写操作中 58 处的 `where` 无显式租户谓词;其中 7 处上下文里也找不到租户谓词。
- **Files**: `lib/server/tenant-scope.ts:41` · 58 处写点(清单见 DEPENDENCY_MAP §3;重点 `purchase-order.ts:416`、`ecn.ts:124`、`part-mfg-mapping.ts:129`、`erp-sync.ts:292,684`、`audit.ts:91`)
- **Risk**: 中。在热路径加断言可能暴露既有"先读后写"模式并抛错 → 必须先**只报不拦**(dev 下 warn / 生产下计数)跑一轮,再切为拦截。
- **Target**: 写操作统一经守卫;确有意不分租户的(`rate-limit.ts:83` 全局桶)显式白名单并注释理由。
- **Migration**: 无。
- **Tests**: golden 安全矩阵扩一条:任意仓储写操作缺租户谓词即失败;7 处无谓词写点各补一条租户隔离用例。
- **Acceptance**: 断言在生产路径真实执行;白名单条目数 = 显式注释数。

## R0-6 · Agent 运行与审批端点无角色守卫,且审批 UI 不存在

- **Priority**: P0
- **Problem**: 两个端点只有 `requireSession()`,**任何已登录租户用户都能触发 AI 运行并批准写入**(全仓 `app/api` 无 `requireRole`)。同时 `grep agent-approvals app components` 只命中路由自身 —— **没有任何 UI 能到达审批端点**,editor 只显示计数徽标。CLAUDE.md 要求的"写工具必须人工确认卡片"在 UI 上是断的。
- **Files**: `app/api/quotes/[versionId]/agent/route.ts:15` · `app/api/agent-approvals/[approvalId]/route.ts:17` · `app/(app)/quotes/[versionId]/editor.tsx:383-386`
- **Risk**: 低(加守卫);建审批 UI 属新增交付面,需确认是否在本轮范围。
- **Target**: 两个端点加权限守卫(建议新增 `quote.agent.run` / `quote.agent.approve`);补最小审批卡片 UI,或**在 UI 上如实标注"AI 写提案暂不可批准"**(诚实 UI 纪律)。
- **Migration**: 无(权限走既有 `PERMISSIONS` 表)。
- **Tests**: E2E:无权限角色调用两端点均 403;有权限角色可运行但写入仍需二次确认。
- **Acceptance**: 二者皆有守卫;UI 要么可批准、要么明确标注不可批准 —— **不允许"看起来能批准但点不到"**。

## R0-7 · 供应商报价按通道落入互斥模型,只有一支进入价格池

- **Priority**: P0(业务结果依赖录入通道)
- **Problem**: 同一事件"供应商报价"有 5 条录入路径,落到两套模型:RFQ 模板 / 公开链接 / 预设 UI → `SupplierOffer` + `PriceBreak`;通用报价 Excel → `SupplierQuote` + `SupplierQuoteLine`(**单价,无阶梯**)。价格池只读前者 → **走通用 Excel 录入的价格永远不参与成本矩阵**。比价接口也只读 `supplierQuoteLine`,与另一支错开。
- **Files**: `lib/server/repositories/rfq-supplier.ts:212-239` · `procurement.ts:216-232,418-438` · `supplier-action.ts:650-670` · `price-pool.ts:128-167` · `app/api/procurement/rfq/[id]/sourcing/route.ts:33-38` · `prisma/schema.prisma:1706-1709,2005-2014`
- **Risk**: **高**。涉及两张有数据的表与四条写路径。绝不可一次切换。
- **Target**: `NormalizedOffer` 为唯一入口 DTO + 显式 `NormalizedOffer ↔ SupplierOffer` mapper;`SupplierQuoteLine` 要么升级为阶梯,要么明确降级为"只读凭证,不参与比价"并在 UI 如实标注。
- **Migration**: 若统一到 `SupplierOffer`,需数据迁移;**REF-0 不决定,进商务/产品确认**(录入通道语义是业务问题)。
- **Tests**: 四条通道各写一条报价 → 断言全部出现在价格池与比价集(或按既定语义显式排除并有 UI 标注);阶梯价往返不失真。
- **Acceptance**: "这条价格会不会参与比价"可由数据本身回答,而非由录入通道决定。

## R0-8 · 零价格只在 4 条路径中的 1 条被拦住

- **Priority**: P0(客户已在前期版本上实际撞到;本仓库同类路径未设防)
- **Problem**: CLAUDE.md B5 与 R4 §58 都明令「绝不按 0 落库 / blank→0 禁止」,但只有**供应商报价文件上传**一条路径真正执行。其余路径 `0` 畅通无阻,并一路进到比价与报价:
  - [supplier-offer-import.ts:126-129](../../lib/domain/supplier-offer-import.ts) 判的是 `< 0`,**`0` 合法** → 0 价阶梯写入 `PriceBreak`;
  - [price-pool.ts:82-114](../../lib/domain/price-pool.ts) `usablePrices` **无零值检查**,`priceRange` 用裸 `Number()` 比较 → **0 被选成最低价**;
  - [compare-summary.ts:79](../../lib/domain/compare-summary.ts) `toDec("0")` 返回 `Decimal(0)` 非 null → 0 价成为 `lowest` 并进导出;
  - [procurement-flags.ts:66-71](../../lib/domain/procurement-flags.ts) 只 flag `price > limit`,0 永不触发;
  - [quote.ts:407-417](../../lib/server/repositories/quote.ts) 提交完整性门禁判 `purchaseCost !== null` → 存了 `0.000000` **照样通过提交**。
- **Files**: 上述五处 + `lib/domain/offers.ts:213,281`(0 价仍参与排名,只是价格分为 0)
- **Risk**: 低。加守卫可能让既有 0 价数据行变为"被拒绝",需先**只报不拦**跑一轮统计存量。
- **Target**: 单一 `assertUsablePrice()`,在**解析 / 落库 / 入池 / 比价 / 提交**五道口共用;0 与空一律进 `skipped` 并记原因,与 `supplier-quote-parse` 现有口径一致。
- **Migration**: 无 schema。需一次存量扫描:`PriceBreak.unitPrice = 0` 的行数与归属供应商(只出聚合计数)。
- **Tests**: ① offer 批量导入 0 价 → 行被拒并记原因;② 价格池含 0 价 → 不被选为最低价;③ 比价总表 0 价不计为 `lowest`;④ `purchaseCost = 0` **不能**通过报价提交门禁;⑤ 既有"单价缺失跳过"的用例不回归。
- **Acceptance**: 五道口共用同一守卫;客户截图那类 `$0.0000` 计入合计的场景有回归用例钉死。

---

# P1 — Architectural Duplication

## R1-1 · Canonical Part Identity(7 套 MPN 归一收敛)

- **Priority**: P1 · **Problem**: 7 个 TS 规则 + 2 个 SQL 规则 + 9 处内联复制(见 DUPLICATION_MATRIX §D1)。
- **Files**: `part-mfg.ts:22` · `providers/common/mpn.ts:9` · `similarity.ts:17` · `bom-purpose.ts:77` · `alternate-bulk.ts:224` · `part-create.ts:109` · `recon-match.ts:104` + 9 内联点
- **Risk**: ~~高~~ → **实测后降为中**(REF-1a #92 已量化,真实数据 27,099 个唯一 MFG_PN):
  | 旧规则 | 与 canonical 不同 | 其中被剥成空串 |
  |---|---|---|
  | **A1** `mfgPartNoKey` | **0 / 27,099** | — |
  | A2/A3/A4/A5(ASCII 四条) | 各 324 / 27,099 | 各 22 |
  | A6 `normalizeInternalPn` | 12,740 / 27,099 | — |

  **关键结论:canonical 选的就是 A1 的规则,而 A1 正是库内 `manufacturerPartNoKey`
  与迁移 r4_3 的口径 → 采纳 canonical 不需要重算该列**,REF-1c 的迁移风险大幅下降。
  A6 差异大属预期(它是内部料号口径,本就不该用作 MPN 键)。

  另一个实测发现:ASCII 规则对**混合中英值**的危害比纯中文更大 ——
  纯中文会被剥成空串(一眼看得出不对),而 `贴片电阻0402-10K` 会被剥成 `040210K`,
  与真实存在的 `0402-10K` **撞成同一个键**(非空但错误)。canonical 下两者不同键。
- **Target**: `modules/parts/domain/part-identity.ts`,`CanonicalPartIdentity`(TS + Zod),字段含 `requestedMpn/normalizedMpn/exactMpn/baseDevice/orderableSuffix/rawManufacturer/canonicalManufacturerId/canonicalManufacturerName/rawPackage/canonicalPackage/customerPn/internalPn/matchType/source`。参考 altpart-pro `part-identity.js` 的**两条纪律**:requested identity 不被模糊结果静默替换;缓存键 = MPN + 厂商 + 封装(厂商须先标准化)。
- **Migration**: 旧函数改 `@deprecated` 薄包装 → 逐点替换 → shadow diff 列出键变化行 → 键变则配套 SQL 重算迁移。
- **Tests**: 各规则等价性参数化用例;`TL431` 对 `[TL431-1, TL431ACDR]` → `exactMpn === null` 且 `requestedMpn` 保持;`AD8331ARQ-REEL7` → base `AD8331` / suffix `REEL7`;缓存键对 TI 与 Texas Instruments 一致、对 SOIC-8 与 TSSOP-8 不同。
- **Acceptance**: 全仓只剩一个归一实现;`grep "replace(/\[\^0-9A-Z\]"` 在生产代码零命中。

## R1-2 · 统一 Manufacturer Registry

- **Priority**: P1 · **Problem**: 5 处归一 + 1 处带外 override;`resolveManufacturer` 在同一函数内混用两套键规则(B1 保空格剥后缀 / B4 剥空格保后缀)。
- **Files**: `providers/common/mpn.ts:15-72` · `part-mfg.ts:27` · `integration/erp/normalization/manufacturer-resolver.ts:70-246` · `repositories/manufacturer-review.ts:131,192` · `integration/erp/uat-package.ts:43,83`
- **Risk**: 中高 —— `ManufacturerAlias.normalizedAlias` 有唯一约束,键规则变化需重算。
  **实测规模**(REF-1a #92,真实数据 2,959 个唯一原始厂商串):

  | 项 | 实测 |
  |---|---|
  | canonical 与库内存量 **B4** 不同 | **234 / 2,959**(7.9%)→ 需重算这些行 |
  | canonical 与 B1(展示归一)不同 | 1,267 / 2,959(43%) |
  | canonical 下撞键组(总) | 344 组 / 906 个原值 |
  | **新增撞键组(B4 下不同键、canonical 下同键)** | **65 组 / 246 个原值** |

  只有最后一行是**真正的迁移工作量** —— 那 65 组会违反唯一约束,
  迁移必须**先合并行再重算键**;其余 279 组在旧规则下本来就是同一行,不构成风险。
  差异来源是 canonical 额外剥掉公司后缀(`Murata` / `Murata Co., Ltd.` 归一为同键)。
- **Target**: `modules/parts/domain/manufacturer-registry.ts`;优先级 ezPLM 标准厂商 → 租户批准别名 → 内置别名 → 仅清洗原值。别名迁入 seed/版本化 reference table。**保留**本仓既有优势:租户别名分域、人工批准、ezPLM 为真源、`§20 不静默生成永久别名`。
- **Migration**: 别名 seed 迁移 + `normalizedAlias` 重算迁移;租户别名不跨租户泄漏的断言先行。
- **Tests**: `TI` / `Texas Instrument` / `Texas Instruments Inc` / `德州仪器` → 同一 canonical;未收录厂商 → `matched:false` 且**不猜**;租户 A 的别名对租户 B 不可见;现有 40.9% 覆盖率 UAT 不回退。
- **Acceptance**: 一套键规则;别名是数据不是代码;`resolveManufacturer` 六级顺序与冲突人工裁决语义不变。

## R1-3 · BOM 归一管线拆分(13 阶段)

- **Priority**: P1 · **Problem**: `bom-parse.ts`(575 行)一个文件承担列映射→表头→行解析→续行合并→Value/MPN 推断→位号计数→封装提取→账本。
- **Files**: `lib/domain/bom-parse.ts` 全文 · `bom-validate.ts` · `bom-match.ts` · `repositories/bom-import.ts`
- **Risk**: 高 —— 续行合并自校准依赖 `countRefDes` 的当前(不展开)语义,改动会移动账本分类。
- **Target**: `modules/bom/` 下 13 个可独立测试的阶段(File Extraction → … → Persistence)。
- **Migration**: feature flag `BOM_NORMALIZER_V2` + shadow run,以 `RawBomRow` 账本恒等式为对拍基准。
- **Tests**: 金样回归按构造期望断言(禁快照);账本恒等式 `totalRows = recognized + mergedIntoPrevious + nonBusiness + needsReview` 逐文件成立。
- **Acceptance**: 差异为零或逐条经人工批准;15MB/17000 行 E2E(`zz-e9`)不回归。

## R1-4 · 位号解析统一 · **R1-5** 封装归一统一 · **R1-6** 列映射词表数据化

- **Priority**: P1(三项同属"归一族",可并入 REF-2)
- **Problem / Files / Target**: 见 DUPLICATION_MATRIX §D3 / §D4 / §D5。
- **Risk**: R1-4 中(改 `countRefDes` 语义会动账本)· R1-5 低 · R1-6 中(`料号` 语义冲突需业务确认)
- **Tests**: R1-4:`R1,R2` / `R1 R2` / `R1-R10` / `R1~R10` / 全角分隔符 / `R1-C5` 不展开 / span 上限 / 原始串保留。R1-5:0402 英制=1005 公制且不与 0402 公制混淆;`SOIC-8` vs `SOP-8` 兼容;`SOIC-8` vs `QFN-16` 不兼容。R1-6:`customer part number` 不被 `part number` 抢走;`料号` 单独出现=MPN、与 `型号/MPN` 并存=内部料号。
- **Acceptance**: 每类只剩一个实现;词表是数据且有快照测试。

## R1-7 · 统一 NormalizedOffer 收敛(含 ezPLM 与线下)

- **Priority**: P1 · **Problem**: 归一 DTO 只覆盖两个分销商;ezPLM 无 offer 概念;线下报价绕过 DTO 直写;`NormalizedOfferSchema` 生产期从不校验。
- **Files**: `providers/common/normalized-offer.ts:30-58` · `repositories/{rfq-supplier,procurement,supplier-action}.ts` · `prisma/schema.prisma:1706`
- **Risk**: 高(与 R0-7 同源,建议合并推进)
- **Target**: 第七节的 `NormalizedOffer`(扩展现有,不新建)+ 双向 mapper + 生产期 `safeParse`。
- **Tests**: 五条录入通道 → 同一 DTO;Schema 校验在生产路径生效并有失败用例。
- **Acceptance**: 业务层只消费 `NormalizedOffer`;`SupplierOffer` 的"归一持久化"注释与代码相符。

## R1-8 · 替代料引擎合一(3 套 → 1 套)

- **Priority**: P1 · **Problem**: A/B/C 三套引擎、三张 source-trust 表、15 处结果构造(DUPLICATION_MATRIX §D7/§D8)。
- **Files**: `alternate-{score,rank,compat,bulk}.ts` · `param-compare.ts` · `similarity.ts` · `repositories/alternate-{search,selection}.ts` · `part-detail.ts:279-409`
- **Risk**: 高。含 R0-2 / R0-3,应在其之后。
- **Target**: `modules/alternates/domain/{quantity-ir,comparison-semantics,constraint,category-profile,scoring,replacement-level,evidence,identity}.ts`;**单一 `buildScoredCandidate()`**;输出 `technicalCompatibility / evidenceCoverage / sourceConfidence / conclusionConfidence` + `hardConstraintViolations[] / needsVerification[] / paramScores[]` + `ReplacementLevel`。
- **硬门(必须实现)**:无 pin map 证据 → **永不** `DIRECT_REPLACEMENT`;UNKNOWN 既不算 0 也不算通过。
- **Migration**: flag `ALTERNATE_ENGINE_V2` + shadow run。
- **Tests**: 导入 altpart-pro 记录的回归口径(`30V→100V` higher_better 通过;`700µA→50µA` lower_better 通过;`Rds(on)@10V` vs `@4.5V` 不可直接比较、封顶且标记;区间覆盖;`SOIC-8` 同名但无几何 → 兼容但**不判 exact**;`pinVerified=false` → 最多 `COMPATIBLE_WITH_REVIEW`)。**用业务断言,不复制 snapshot。**
- **Acceptance**: 三套引擎的输出可互相解释;`PACKAGE_SCORE.UNKNOWN > DIFFERENT` 这类反常权重被消除或显式论证。

## R1-9 · 引入 application / use case 层

- **Priority**: P1 · **Problem**: 该层不存在;业务编排落在 route handler(12 个)或 repository(18 个伪装 use case),仓储互调 35 条边。
- **Files**: 见 DEPENDENCY_MAP §2.4 / §2.5
- **Risk**: 中。纯搬运 + 签名变更,可逐 context 推进。
- **Target**: `modules/<ctx>/application/*UseCase.ts`;repository 退回纯数据访问。
- **Tests**: 每个抽出的 use case 首次获得单测(当前 35/38 仓储零单测)。
- **Acceptance**: 仓储互调边归零或显式经 use case;`SessionRef` 迁出 `rfq.ts`。

## R1-10 · 双 ERP 同步栈合并 · **R1-11** API 命名收敛 · **R1-12** 重复端点下线

- **Priority**: P1 · 见 ARCHITECTURE_AUDIT §10(A1–A6)
- **Target**: canonical `/api/procurement-rfqs/:id` + 子资源;旧路径保留 compatibility handler 并回 `Deprecation`/`Sunset` 头;`[lineId]` 七义消歧。
- **Risk**: 中(UI 调用点需同步)· **Tests**: 旧路径仍可用且带弃用头;新路径契约测试· **Acceptance**: 调用点全部迁完后才删旧路径。

## R1-13 · Agent Runtime 统一 · **R1-14** lib/ai 与 lib/agents 边界

- **Priority**: P1 · **Problem**: 无 tool dispatcher(工具声明零消费);`lib/ai/provider.ts:13` 反向依赖 `lib/agents/types`(类型级循环);OCR 绕过 Agent 体系直调 LLM 且无 AgentRun;`AgentTypeValue` 与 Prisma 枚举漂移(缺 `TRACE`);`agentMode()` 从不调用。
- **Files**: `lib/ai/**` · `lib/agents/**` · `lib/providers/ocr/recognize.ts:5,44` · `repositories/agent-run.ts`
- **Risk**: 低(只有一个 Agent,改造面小 —— **现在是做这件事最便宜的时候**)。
- **Target**: `AgentDefinition` / `AgentToolDefinition` / `AgentContext` / `AgentRunResult`;真实 dispatcher 用声明的 Zod schema 校验工具 I/O;读工具自动、写工具必须审批;`TokenUsage` 迁到 `lib/ai` 以消除反向依赖。
- **Tests**: 工具 I/O 经声明 schema 校验;LLM 失败**不得**记为 `SUCCEEDED`(当前会,见 ARCHITECTURE_AUDIT §4.5);`idempotencyKey` 生效,重复 POST 不产生重复 run。
- **Acceptance**: 枚举两侧一致;OCR 要么纳入 Agent 体系要么显式声明为非 Agent LLM 用途并有同等留痕。

## R1-15 · 聚合粒度分层(标准 BOM 逐位号 / 询价采购按 MPN+制造商 / 多 BOM 跨 BOM)

- **Priority**: P1 · **Problem**: BOM 按位号逐行存储,而询价单/采购单直接照搬 BOM 行 → 同一 MPN 被询价七次、采购单物料重复(客户 F9 与第四节的直接诉求)。本仓库**两个方向都有风险**:`replaceLines`([purchase-order.ts:131-190](../../lib/server/repositories/purchase-order.ts))删后重建**无 MPN 唯一性检查**、`parsePoBulkText` **无重复检测**(该合的没合);而三处去重键**不含制造商**(不该合的会合)。
- **Risk**: 中高。聚合会改变采购单行数与金额分布。
- **Target**: 三层显式语义 —— 标准 BOM/客户报价单逐位号保留;询价/比价/采购按 `(canonicalMpn, canonicalManufacturerId)` 聚合并合并数量;多 BOM 对比跨 BOM 聚合。
- **Migration**: **必须排在 REF-1 之后** —— 先有 Canonical Identity 才能用正确的键聚合。
- **Tests**: 同 MPN 多位号 → 标准 BOM 保留 N 行、询价单 1 行且数量为合计;同 MPN 不同制造商 → **不合并**;采购单重复行被拒并提示。
- **Acceptance**: 客户截图那种"七行同一 MPN"的询价单不再产生;同时同 MPN 两制造商不被塌缩。

## R1-16 · BOM 核对未完成禁止对外询价

- **Priority**: P1 · **Problem**: 客户流程调整第 1 条明确"禁止直接向 Digikey、Mouser 发起询价,BOM 必须完成人工核对,核对无误后由审核人流转至采购"。本仓库有逐行确认与批量确认([bom-detail.ts:211](../../lib/server/repositories/bom-detail.ts)),但**无此守卫** —— 可在未核对状态直接触发寻源。
- **Risk**: 低(加门禁),但会改变现有操作动线,需 UI 明示原因。
- **Target**: 寻源入口前置校验"该 BOM 版本全部行已决策";未通过时返回可读原因与待办计数,**不静默失败**。
- **Tests**: 未完成核对 → 寻源接口 422 且带待办行数;完成后放行;批量确认后即时放行。
- **Acceptance**: 对外 API 调用不可能发生在核对完成之前。

## R1-17 · 比价导出缺数量列,放大后的采购数量在导出文件里不可见

- **Priority**: P1 · **Problem**: `purchaseQty = calculateRoundedPurchaseQty(demandQty,{moq,spq})` 后**按放大数量取价与算总价**([offers.ts:127-135](../../lib/domain/offers.ts));UI 如实并列显示了需求与采购数量,`price-pool` 还把口径显式化为 `SELECTED_BUY_QTY/SUGGESTED_BUY_QTY/DEMAND_QTY` 并持久化 —— **但比价导出没有任何数量列**([compare-export/route.ts:106-117](../../app/api/procurement/rfq/[id]/compare-export/route.ts))。客户拿到的正是导出文件,这就是"报价数量与需求数量不一致"观感的直接来源。
- **Risk**: 低(纯增列)。
- **Target**: 导出补 `需求数量 / 报价(采购)数量 / 数量口径` 三列,口径值直接用既有 `priceQtyBasis` 枚举。
- **Tests**: 导出含三列;MOQ 放大场景下两个数量不同且口径列为 `SUGGESTED_BUY_QTY`。
- **Acceptance**: 导出文件可自证"为什么这个数量" —— 不需要回系统里看。

## R1-18 · 无 MPN / 无匹配行在报价与寻源中被硬丢且不告知

- **Priority**: P1(与"账本不允许静默丢行"的既有纪律自相矛盾)
- **Problem**: ① [quote-from-bom.ts:34](../../lib/server/repositories/quote-from-bom.ts) 过滤掉 `decision === "NO_MATCH"` 的行 —— **正是需要采购补全 MPN 与价格的那些行永远不会变成 QuoteLine**,且返回的 note 只统计缺成本行,**不告知丢了几行**;② [sourcing/route.ts:40](../../app/api/procurement/rfq/[id]/sourcing/route.ts) `filter(l => l.mpn)`,进度按 `targets.length` 计算 → 无 MPN 行**连分母都被抹掉**。客户 F4/F5 明确要求这些行必须保留。
- **Risk**: 中。保留这些行会改变报价行数与完整性门禁的分母。
- **Target**: 新增"待补全(NEEDS_COMPLETION)"行状态;报价与寻源都保留该类行、计入分母、在 UI 与导出如实标注;提交门禁按既有纪律拒绝含未补全行的提交(而不是悄悄不算)。
- **Tests**: 含 NO_MATCH 行的 BOM 生成报价 → 行保留且标待补全;寻源进度分母含无 MPN 行;丢行数在返回值里可见。
- **Acceptance**: 从 BOM 到报价的行数变化**可对账**,与导入账本恒等式同一纪律。

---

# P2 — Maintainability

| ID | 项 | Problem / Files | Risk | Target | Tests / Acceptance |
|---|---|---|---|---|---|
| **R2-1** | 页面直连 Prisma | 34/57 页面直连,18 个完全不经仓储;`inventory/page.tsx` 8 处;`portal/layout.tsx:29` 在 layout 里解析租户 | 低(逐页) | 每 context 一个 Query Service | 每页迁移后 E2E 不变;最终 `page.tsx` 零 `@/lib/server/db` 导入(平台工具例外须注释) |
| **R2-2** | 路由内含业务算法 | 12 个路由(`search` 215 行/10 查询、`sourcing` 整个 use case…) | 中 | 移入 use case | 路由行数与 Prisma 调用双降;行为不变 |
| **R2-3** | 混合型 repository 拆分 | `traceability`990 / `erp-sync`858 / `supplier-action`726 / `bom-import`642 / `part-detail`578(12 个 Provider 导入) | 高 | Repository / UseCase / Domain / Integration 四分 | 拆分前先补 golden 对拍 |
| **R2-4** | `lib/routes.ts` 十职分离 | 450 行 10 职责;读者分布已给出拆法 | 低 | `routes.ts` / `features.ts` / `permissions.ts` / `delivery-scope.ts`;`RoleName` 迁到 `lib/auth` | 14 个只要 `RoleName` 的模块不再依赖导航表 |
| **R2-5** | 权限六套并存 | 54 个路由内联角色 vs 27 个用 `requirePermission`;`quality.*` 定义了却**任何路由都不强制** | 中 | 统一 `requirePermission`;`AppRoute.permission` 类型化为 `Permission` | 每条权限至少一个强制点或显式标注"仅页面级" |
| **R2-6** | 搜索范围两份已不一致 | `SEARCH_SCOPES` 的 SUPPLIER 为 `["OPO(本供应商)"]`,`ROLE_ENTITIES` 为 `[]` | 低 | 单一真源派生标签 | 单测锁双向一致 |
| **R2-7** | `lib/metrics` 是未申报的数据层 | 8 文件直连 Prisma,被页面直接调用 | 低 | 归入 Query Service | — |
| **R2-8** | Provider 工厂无注册表 | 7 工厂;memo 逐字复制 3 份;`PROVIDERS_FORCE_MOCK` 只覆盖 3 个;**未知 vendor 静默回落 Mock**(违反"禁止假成功") | 中 | 统一注册表 + 统一 mock 开关;未知 vendor **抛错** | 未知 vendor 不得返回 Mock 的用例 |
| **R2-9** | Zod 校验三套 | DigiKey/Mouser 走共享 client;ezPLM 自己实现一遍;Lab 第三套 `DecimalStringSchema` | 低 | 共用 `ProviderHttpClient` | 契约测试覆盖三源 |
| **R2-10** | 导出接口 17 个三套约定 | `/export`、`-export`、`?export=1` | 低 | 单一约定 | — |
| **R2-11** | `column-mapping.ts` 零直接单测 | 7 消费者依赖,是本轮升级基座 | 低 | 补单测(**REF-2 前置**) | 表头打分、精确优先、必填缺失、多行扫描各有用例 |
| **R2-12** | Prisma 模型归属未记录 | 125 model 单文件,51 次提交 | 低 | `PRISMA_MODEL_OWNERSHIP.md`(**本轮只出文档,不拆物理文件**) | 每个 model 落到唯一 context |
| **R2-13** | 客户报价单导出契约未固化 | 客户模板 26 列 + 表头区 6 项 + 表尾(合计/单板报价);`QuoteLine` 缺 MOQ/SPQ/LT/供应商列,`note` 只有 1 个(模板有 4 个备注列);**第二组数量列**对应多数量档报价,模型缺位 | 中 | 固化为导出契约 + golden 夹具;多数量档需 `QuoteVersion` 级 schema 增量 | 导出文件与客户模板逐列对齐,金样锁定 |
| **R2-14** | 损耗率不可配 | `DEFAULT_SCRAP_RATE="0"`、`scrapRateConfirmed` 硬编 `false`([gtb.ts:14,49](../../lib/domain/gtb.ts)),唯一入口是 GTB 试算器的自由文本框;F2 要求"按损耗规则自动算" | 低 | 租户 / 客户 / 品类级损耗规则,保留"未确认即标注"的既有诚实口径 | 报价数量可由需求数量 + 规则确定性推出,且口径可追 |

## R2-12 补充:Prisma 模型归属(按 ARCHITECTURE_AUDIT §1 的 11 个 context)

逐个归属后精确合计 **125 = 9 + 18 + 2 + 7 + 3 + 9 + 12 + 16 + 18 + 4 + 27**:

| Context | 数 | 模型 |
|---|---|---|
| BOM | 9 | BOM, BOMVersion, BOMLine, BomVersionManufacturingInfo, BOMImportJob, BomCompareRun, BomMatchCandidate, BomLineDecision, RawBomRow |
| Parts 主数据 | 18 | Part, CanonicalManufacturerRef, ManufacturerAlias, PartMfgMapping, PartIdentifier, CustomerPartMapping, PartProcessAttr, PartCodeRule, PartComplianceDeclaration, PartComplianceEvidence, PartTag, PartTagLink, PartAttributeDefinition, PartAttributeValue, PartDocument, PartSupplierRef, PartCreationRecord, ExternalPartSnapshot |
| Alternates | 2 | PartAlternate, AlternateSelection |
| Sourcing | 7 | SupplierOffer, PriceBreak, ProcurementRFQ, ProcurementRfqSupplierLine, SupplierQuote, SupplierQuoteLine, ProcurementPolicy |
| RFQ(客户) | 3 | RFQ, RFQAttachment, RFQStatusHistory |
| Quote | 9 | Quote, QuoteVersion, QuoteLine, QuoteApproval, QuoteTemplate, QuoteBatchUpdateJob, QuoteComponentTask, NreItemDefinition, BomCostSelection |
| PO / OPO 履约 | 12 | PurchaseRequest, PurchaseOrder, PurchaseOrderLine, PurchaseOrderApproval, OPOLine, OPOReply, ReminderLog, PoAcknowledgement, ShortageSheet, ShortageSheetLine, CallMaterialRecord, SupplierOnboardInvite |
| ERP 集成 | 16 | ErpConnection, ErpCredential, ErpFieldMapping, ErpSyncPolicy, ErpSyncJob, ErpSyncJobLine, ErpConflict, ErpWebhookEvent, IntegrationJob, IntegrationSyncRecord, ErpUatImportBatch, InventorySnapshot, ExcessSnapshot, ExcessLine, OpenPOLine, FxRate |
| Traceability / 质量 | 18 | TraceImportBatch, ReceiptLot, MaterialLot, TraceWorkOrder, WorkOrderMaterialIssue, FinishedGoodsLot, TraceShipment, TraceShipmentLine, TraceEdge, TraceEvent, LotSplitMerge, TraceSubstitution, TraceAnalysisRun, FinishedGoodsSerial, QualityIncident, ContainmentAction, ScrapRecord, ScrapExportTemplate |
| ECN | 4 | Ecn, EcnChangeLine, EcnApproval, EcnCustomerNotice |
| 平台 | 27 | Tenant, User, Role, UserRole, TenantSettings, Customer, Supplier, SupplierContact, PermissionGrant, UserPermission, AuditLog, PortalAccount, PortalInvite, SupplierActionRequest, RateLimitBucket, ApiUsageLog, AgentRun, AgentStep, AgentEvidence, AgentApproval, OutboundMessage, MessageRecipient, MessageAttachment, MessageDeliveryEvent, EmailDraft, ReconciliationStatement, ReconciliationLine |

边界待议的两个:`BomCostSelection`(归 Quote,但由 BOM 版本驱动)、
`PartSupplierRef`(归 Parts 主数据,但被 Sourcing 消费)。
**第十七节判断:当前风险高于收益 —— 本轮只产出归属文档,不做多文件 schema 物理拆分。**
理由:57 个迁移、125 个 model、`demo-reset-plan` 的全表覆盖校验都绑在单文件上,
拆分收益是可读性,代价是一次高风险的全量迁移重排。

---

# P3 — Cleanup

| ID | 项 | 证据 | 删除条件 |
|---|---|---|---|
| **R3-1** | `@prisma/client` 版本 caret 漂移 | `prisma 7.9.0` / `adapter-pg 7.9.0` / **`client ^7.9.0`** | 改为精确 `7.9.0`,`pnpm install` + `migrate` + `generate` 复测通过 |
| **R3-2** | `legacy-static/`(8.0MB/141 文件) | 仅 `nav-icon.tsx:3` 一句注释引用 | 确认设计资产已全部抽到 `globals.css`/`components/ui` 后归档(**建议移出仓库而非删除**) |
| **R3-3** | 21 个孤儿 API 端点 | 见 ARCHITECTURE_AUDIT §10 | 逐个确认无外部调用方(含客户/RPA)后删;`agent-approvals` 属 R0-6,**不删,是要接 UI** |
| **R3-4** | `lib/auth/token-verifier.ts` | 46 行,含测试在内**全仓零引用** | **保留**(CLAUDE.md 要求的 SSO 预留钩子),但必须补一条单测钉住"未配置公钥时 verify 返回 null,绝不伪造通过" |
| **R3-5** | `lib/providers/fx/` | `convertAmount` 无生产调用方;`prisma.fxRate` 从不被查询;`usablePrices` 的 `allowedCurrencies` 每个生产调用方都省略 → `INVALID_CURRENCY` 排除形同虚设 | **保留**(等 O3 汇率口径),但 `cost-matrix.ts:6-7` 的注释声称"跨币种需 FX 可换否则拒绝"与 `selectCost` 无任何币种检查**不符** → 先修注释或补检查 |
| **R3-6** | `components/ui/module-placeholder.tsx` | `ModulePlaceholder` 零调用方;而 `routes.test.ts:101-127` 仍拿它与 `implemented` 做双向校验 | 与 R2-4 一并处理 |
| **R3-7** | `lib/integration/erp/sources/kingdee/api/` | 仅测试引用 | **保留**(等金蝶文档 O1,预期状态) |
| **R3-8** | 20+ 条陈旧本地分支 | `feat/f1-*`…`feat/pr-a-*` | 确认已合并后 `git branch -d` |
| **R3-9** | 陈旧文档 | `SPEC.md`/`KICKOFF_PROMPTS.md`/`SCHEMAMERGEMAP.md` 停在 2026-07-27;`reference/nestjs-v15/` 目录不存在但 README/INTEGRATION_PLAN 仍提及 | 标注归档状态,不删(验收对照原件) |

---

## 执行建议

1. **先做 REF-0.5(P0 修复)**,再做 REF-1。四个 P0 各自独立、可回滚、每个都能被一条回归用例钉死;
   混进大重构会让 Golden Master 失去基准 —— 无法区分"差异来自修 bug"还是"差异来自重构"。
2. **REF-1 的真正前置是测试基建**,不是代码:35/38 仓储零单测,shadow-run 框架必须先于 Canonical Identity 落地。
3. **R0-7 / R1-7 需要业务输入**(录入通道语义),不是纯工程决策 → 进待商务确认池。
