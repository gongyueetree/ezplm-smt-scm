# DUPLICATION MATRIX — REF-0

> 基线:`main` @ `9de0409`(Merge PR #86,R4 v2 收尾)。分支 `docs/ref-0-architecture-audit`。
> 本文件只陈述**代码事实**,每条结论带 `file:line` 证据。REF-0 不改生产代码。
>
> 阅读约定:
> - **删除条件**一栏是"什么时候可以删掉实现 B",不是"建议删"。没满足条件之前不许删。
> - 迁移方式一律遵循第十九节的 Golden Master:旧实现留在生产路径,新实现 shadow run,
>   差异清零或经人工批准后才 flip flag,最后删旧。

---

## 0. 总览:9 类重复能力

| # | 重复能力 | 实现数 | 最高优先级 | 一句话 |
|---|---|---|---|---|
| D1 | MPN / 料号归一键 | **7 个 TS 规则 + 2 个 SQL 规则** | **P0** | 规则不一致已造成**线上静默失配**(§D1.1) |
| D2 | 制造商归一 / 别名 | **5 处 + 1 处带外机制** | P0 | 两套键规则在同一个函数里混用 |
| D3 | 位号(RefDes)解析 | 1 个展开 + 3 个各自的分词 | P1 | `R1-R10` 在一处算 10,在另一处算 1 |
| D4 | 封装 / Footprint 归一 | **5 个** | P1 | 类别字母表 13 vs 9,互相不知道 |
| D5 | 表头 / 列映射引擎 | **3 个引擎 + 10 份词表** | P1 | `料号` 在一处是 MPN,在另一处是内部料号 |
| D6 | 报价单 / 阶梯价表示 | **7 种 DTO + 3 种持久化** | **P0** | 同一业务事件按通道落到**互斥的两张表** |
| D7 | 替代料评分 | **3 套互不通信的引擎** | **P0** | 三张互相冲突的 source-trust 表 |
| D8 | 候选结果对象构造 | **15 处独立字面量** | P1 | altpart-pro 的原教训在本仓已复现 |
| D9 | Provider 工厂 / 缓存 | 7 个工厂,3 份逐字复制的 memo | P2 | 无统一注册表 |

---

## D1 · MPN / 料号归一键 —— **P0,已造成线上缺陷**

### D1.1 结论先行:乾创 MFG 通道对含非 ASCII 的 MFG_PN 静默失配

写入侧与查询侧用了**不同的归一规则**:

| 环节 | 位置 | 规则 | 保留 CJK |
|---|---|---|---|
| 写入 `PartMfgMapping.manufacturerPartNoKey` | [lib/domain/part-mfg.ts:22](lib/domain/part-mfg.ts:22) 经 [part-mfg-mapping.ts:52](lib/server/repositories/part-mfg-mapping.ts:52) | `.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "")` | **是** |
| 库内重算 | [migrations/…r4_3_key_recompute/migration.sql:3-5](prisma/migrations/20260915210329_r4_3_key_recompute/migration.sql) | `regexp_replace(upper(…), '[^[:alnum:]]', '', 'g')` | **是** |
| **查询侧**构造 `IN` 键 | [lib/server/repositories/bom-import.ts:273](lib/server/repositories/bom-import.ts:273) | `.toUpperCase().replace(/[^0-9A-Z]/g, "")` | **否** |
| **匹配侧**查 Map | [lib/domain/bom-match.ts:169](lib/domain/bom-match.ts:169) → [providers/common/mpn.ts:9](lib/providers/common/mpn.ts:9) | `.replace(/[^0-9A-Za-z]/g, "").toUpperCase()` | **否** |

`buildMatchContext` 用 ASCII 规则算出 `mpnKeys` 去查 `manufacturerPartNoKey: { in: mpnKeys }`
([bom-import.ts:281-285](lib/server/repositories/bom-import.ts:281));库里存的却是 CJK 保留键。
两者对**纯 ASCII** 输入结果相同,对含中文/非 ASCII 的 MFG_PN 结果不同 → 该行映射永远查不出来,
`QC_MFG_MFR_MPN` / `QC_MFG_MPN` 通道静默返回空,**不报错、不降级、无任何提示**。

第二重错配:即使查出来了,Map 用**库值**(CJK 保留)做键
([bom-import.ts:364](lib/server/repositories/bom-import.ts:364)),而 `bom-match` 用 ASCII 键去取
([bom-match.ts:288](lib/server/repositories/../domain/bom-match.ts:288))。

**真实数据影响面(对乾创私有夹具实测,仅聚合计数,未输出任何真实值)**:

| 文件 | MFG_PN 非空 | 含非 ASCII | 占比 |
|---|---|---|---|
| 物料 MFG 维护单 | 52,256 | **510** | 1.0% |
| 采购订单 | 458 | **11** | 2.4% |

即 **521 条真实映射当前不可达**。测试没抓到,因为
[tests/unit/bom-match-v3.test.ts:68,105,117,187](tests/unit/bom-match-v3.test.ts:68) 的
`mfgByMpnKey` 全部用纯 ASCII MPN 构造。

> 附带事实:R4-2 迁移注释([r4_2_material_identity/migration.sql:85](prisma/migrations/20260915125430_r4_2_material_identity/migration.sql))
> 曾声称"Key 规则与 lib/domain/part-mfg.ts 完全一致",当时为**假**;r4_3 迁移已修库内值,
> 但**没有同步修 TS 查询侧**。这正是"同一规则散落多处"的典型代价。

### D1.2 全部实现清单

| 实现 | 位置 | 规则 | CJK |
|---|---|---|---|
| A1 `mfgPartNoKey` / `manufacturerKeyOf` | [lib/domain/part-mfg.ts:22-29](lib/domain/part-mfg.ts:22) | `[^\p{L}\p{N}]` | 保留 |
| A2 `normalizeMpn` | [lib/providers/common/mpn.ts:9](lib/providers/common/mpn.ts:9) | `[^0-9A-Za-z]` | 剥除 |
| A3 `normalizeForCompare` | [lib/domain/similarity.ts:17](lib/domain/similarity.ts:17) | `[^0-9A-Z]` | 剥除 |
| A4 `normalizePnKey` | [lib/domain/bom-purpose.ts:77](lib/domain/bom-purpose.ts:77) | `[^0-9A-Z]` | 剥除 |
| A5 `normalizePn` | [lib/domain/alternate-bulk.ts:224](lib/domain/alternate-bulk.ts:224) | `[^0-9A-Z]` | 剥除 |
| A6 `normalizeInternalPn` / `mpnKeySegment` | [lib/domain/part-create.ts:109](lib/domain/part-create.ts:109) | NFKC + 空白/连字符规整 + 卷带后缀剥离 | 保留 |
| A7 `matchKey` | [lib/domain/recon-match.ts:104](lib/domain/recon-match.ts:104) | 仅 `trim().toUpperCase()`,**不剥标点** | 保留 |
| SQL-1 | r4_2 migration:98-99 | `[^0-9A-Z]` | 剥除 |
| SQL-2 | r4_3 migration:3-5 | `[^[:alnum:]]` | 保留 |

**另有 8 处未导出的内联复制**(全部是 `[^0-9A-Z]`):
[bom-parse.ts:473](lib/domain/bom-parse.ts:473)、[bom-compare.ts:31,36](lib/domain/bom-compare.ts:31)、
[bom-match.ts:333-334](lib/domain/bom-match.ts:333)、[bom-import.ts:53,273](lib/server/repositories/bom-import.ts:53)、
[ecn.ts:431](lib/server/repositories/ecn.ts:431)、[ecn-impact.ts:48](lib/server/repositories/ecn-impact.ts:48)、
[erp-lab-adapter.ts:49](lib/providers/master-data/erp-lab-adapter.ts:49);
1 处内联复制 A1 规则:[supplier-strategy.ts:206](lib/server/repositories/supplier-strategy.ts:206)。

| 项 | 内容 |
|---|---|
| **当前调用者** | A2 被 ~20 处调用(bom-match、ezplm/http、cache、dedupe、digikey/mouser mock、part-detail、alternate-search、part-create);A1 被 manufacturer-resolver、manufacturer-review、part-mfg-mapping、price-pool 调用 |
| **差异** | 是否保留 CJK;是否剥标点;是否剥卷带后缀(`-TR`/`T&R`/`REEL`) |
| **Canonical 目标** | `modules/parts/domain/part-identity.ts` 的 `normalizedMpn`(CJK 保留,即 A1 规则)+ 显式 `orderableSuffix` 拆分(A6 的能力) |
| **迁移方式** | 新建 canonical → 旧函数改为 `@deprecated` 薄包装转调 canonical → 逐调用点替换 → **shadow diff 跑全量真实夹具,列出键变化的行** → 若键变化则必须配套 SQL 重算迁移 |
| **删除条件** | ① 全部调用点迁完 ② 库内 `manufacturerPartNoKey`/`manufacturerKey` 经迁移重算并与 TS 规则单测锁死 ③ 新增回归用例:含 CJK 的 MFG_PN 能命中(当前缺失) |

---

## D2 · 制造商归一 / 别名 —— P0

| 实现 | 位置 | 规则 | 空白 | 公司后缀 |
|---|---|---|---|---|
| B1 `normalizeManufacturer` | [lib/providers/common/mpn.ts:15](lib/providers/common/mpn.ts:15) | 去标点 + 剥 `CO/LTD/INC/CORP/…` + 压空白 | **保留** | **剥除** |
| B2 `manufacturerAliases` | [mpn.ts:26](lib/providers/common/mpn.ts:26) | 按 `/[/&\|+]/` 拆分 | — | — |
| B3 `manufacturerMatches` | [mpn.ts:39-72](lib/providers/common/mpn.ts:39) | 词序前缀 + 单 token ≥4 字前缀 | — | — |
| B4 `manufacturerKeyOf` | [lib/domain/part-mfg.ts:27](lib/domain/part-mfg.ts:27) | = A1 | **剥除** | **保留** |
| B5 `resolveManufacturer` | [manufacturer-resolver.ts:72-246](lib/integration/erp/normalization/manufacturer-resolver.ts:72) | 6 级:租户别名→全局别名→标准名精确→MPN 证据(0.98,须人工)→模糊(0.60)→UNRESOLVED | 经 B4 | 经 B4 |
| B6 别名 override(带外) | [uat-package.ts:43,83](lib/integration/erp/uat-package.ts:43) → [uat-import.ts:298,413](lib/server/repositories/uat-import.ts:298) | 私有 JSON,哈希留痕,不入库不进 git | — | — |

**核心冲突**:`"MURATA ELECTRONICS"` 经 B1 → `"MURATA ELECTRONICS"`,经 B4 → `"MURATAELECTRONICS"`。
而 `resolveManufacturer` **在同一个函数里同时用两套**:精确层用 B4([:99-100](lib/integration/erp/normalization/manufacturer-resolver.ts:99)),
模糊/冲突层用 B1+B3([:182,157,212](lib/integration/erp/normalization/manufacturer-resolver.ts:182))。

持久化:[ManufacturerAlias](prisma/schema.prisma:1039)(`@@unique([tenantId, normalizedAlias])`,`tenantId=""` 即 GLOBAL)、
[CanonicalManufacturerRef](prisma/schema.prisma:1000)(`normalizedName @unique`)。写入只经
[manufacturer-review.ts:131,192](lib/server/repositories/manufacturer-review.ts:131),用 B4。

| 项 | 内容 |
|---|---|
| **Canonical 目标** | `modules/parts/domain/manufacturer-registry.ts`,**单一键规则**;别名数据迁进 seed / 版本化 reference table;租户新增别名必须人工批准(现有 `manufacturer-review` 流程已正确,保留) |
| **参考资产** | bom2buy `lib/bom/references.ts`:52 个标准厂商 / 112 条别名(**其中 42 条中文**:德州仪器、意法半导体、国巨、兆易创新…),另有 `MANUFACTURER_DOMAINS` 52 域名→47 标准名的**第二索引**(域名比名称字符串更可靠)。收购归并规则成熟(Linear/Maxim→ADI,Cypress/IR→Infineon,Fairchild→onsemi,Atmel→Microchip,Freescale→NXP,Intersil/IDT→Renesas,EPCOS→TDK) |
| **必须保留的本仓纪律** | bom2buy 的别名表是**模块级全局常量,无租户概念**,且由 `regAlias` 副作用装配、无法 diff/seed。本仓的租户别名分域 + 人工批准 + ezPLM 为真源**优于**参考仓,不得倒退 |
| **未知厂商策略** | bom2buy 明确"只清洗不猜"(`matched: false` 显式传播),与本仓 §20「不静默生成永久别名」一致 —— 两边一致,采纳 |
| **删除条件** | B1/B4 合一且 `resolveManufacturer` 只用一套键;别名表迁入 reference data 并有 seed 迁移;现有 40.9% 覆盖率 UAT 断言不回退 |

---

## D3 · 位号(RefDes)—— P1

| 实现 | 位置 | 能力 |
|---|---|---|
| C1 `expandRefDes` | [lib/domain/bom-validate.ts:11-39](lib/domain/bom-validate.ts:11) | **唯一真正展开**:`[;、,]`→`,`,范围正则 `^([A-Za-z]+)(\d+)\s*[-~—]\s*([A-Za-z]*)(\d+)$`,前缀不一致(`R1-C5`)不展开,跨度 ≤10000 |
| C2 `countRefDes` | [lib/domain/bom-parse.ts:133](lib/domain/bom-parse.ts:133) | 只计数,**不展开范围** → `R1-R10` 计为 1 |
| C3 `looksLikeRefDesList` | [bom-parse.ts:119](lib/domain/bom-parse.ts:119) | 第二套分词 |
| C4 `refDesClass` | [lib/domain/kicad-value.ts:29](lib/domain/kicad-value.ts:29) | 第三套分词 + 前缀分类表 |

**差异后果**:C1 对 `R1-R10` 给 10,C2 给 1;C2 驱动续行合并自校准
([bom-parse.ts:367-368,486](lib/domain/bom-parse.ts:367)),C1 驱动重复位号/数量校验
([bom-validate.ts:64,89,109](lib/domain/bom-validate.ts:64))。两者对同一行的"位号个数"不同。

| 项 | 内容 |
|---|---|
| **Canonical 目标** | `modules/bom/domain/reference-designator.ts`,返回 `{ refs, original, expandedRanges, unparsed }` |
| **参考资产** | bom2buy `lib/bom/references.ts` 更完整:分隔符含全角 `，、；`,范围符含 `–—…`,`MAX_RANGE_SPAN = 500` 脏数据护栏,`to < from` 不反向展开,并提供 `compactReferences()` 回折。**关键纪律与本仓一致:原始串必须保留**("导出给客户时要用他们写的形式") |
| **迁移方式** | 先补 C1 缺口(全角分隔符、反向范围、span 上限),再让 C2/C3/C4 转调 canonical;C2 改为调用 `refs.length` 会**改变续行合并行为** → 必须走 golden diff |
| **删除条件** | 金样回归证明续行合并账本恒等式([bom-ledger](lib/domain/bom-ledger.ts))不变,或差异经人工批准 |

---

## D4 · 封装 / Footprint —— P1

| 实现 | 位置 | 规则 | 保留 `-`/`_` |
|---|---|---|---|
| D4-1 `normalizeFootprint` | [bom-validate.ts:158](lib/domain/bom-validate.ts:158) | `[^0-9A-Z]` | 否 |
| D4-2 内联 | [bom-match.ts:330-334](lib/domain/bom-match.ts:330) | 同上,**未调用 D4-1** | 否 |
| D4-3 `footprintAgreement` | [similarity.ts:65](lib/domain/similarity.ts:65) | 同上,但输出 1/0.6/0/**null** | 否 |
| D4-4 `cleanPackageName` 族 | [part-spec.ts:47-108](lib/domain/part-spec.ts:47) | 只压空白,**保留 `-`/`_`**;剥库前缀;`CLASS_PREFIX` **13 个字母**;`FIXED_PIN_COUNT`(SOT-23 是 3 脚不是 23) | 是 |
| D4-5 `parseKicadFootprint` | [kicad-value.ts:147](lib/domain/kicad-value.ts:147) | 提取封装代码;`CLASS_SEGMENT` **9 个字母**(缺 `CP`/`FL`) | — |

**名字冲突**:两个不同的导出 `parseKicadFootprint` —— [kicad-value.ts:147](lib/domain/kicad-value.ts:147)(字符串→代码)
与 [kicad-footprint.ts:105](lib/domain/kicad-footprint.ts:105)(`.kicad_mod`→SVG 几何)。

| 项 | 内容 |
|---|---|
| **Canonical 目标** | `modules/parts/domain/package-normalize.ts`,输出 `{ raw, normalized, kicadFootprint?, family?, pinCount?, mountType, imperial?, metric?, matched }` |
| **参考资产** | bom2buy `packageNormalize.ts`:`CHIP_SIZES` 10 组英制↔公制对照 + 53 个标准 IC 封装 / 170 个查找键。**必须抄的警告**:0402 英制 = 1005 公制,0402 公制 = 01005 英制 —— 搞反选错尺寸 |
| **不要抄的债** | bom2buy 把任意 4 位码一律当英制,真·公制标注会被静默归错且无标记;`icAliases()` 生成的 `SOT8→SOT-23-8` 会误标真 SOT-8/TO-8;`CHIP_SIZES[0]` 声明后又被就地打补丁 |
| **删除条件** | 四处调用点统一;`CLASS_PREFIX` 字母表合一;`detectFootprintMismatch` 金样不变 |

---

## D5 · 表头 / 列映射 —— P1

### 三个互不相干的引擎

| 引擎 | 位置 | 表头归一 | 匹配方式 | 表头行检测 |
|---|---|---|---|---|
| E1 通用 | [lib/domain/column-mapping.ts](lib/domain/column-mapping.ts) | `normalizeHeader`:去空白/下划线/连字符/全半角括号/冒号等([:22](lib/domain/column-mapping.ts:22)) | 精确 `10000-rank` > 子串 `1000+len`([:33](lib/domain/column-mapping.ts:33)) | 扫前 10 行打分([:91](lib/domain/column-mapping.ts:91)) |
| E2 金蝶 profile | [profiles/qianchuang-k3-v1.ts](lib/integration/erp/profiles/qianchuang-k3-v1.ts) | **不归一**,只 `.trim()`([workbook.ts:53](lib/integration/erp/sources/kingdee/excel/workbook.ts:53)) | **精确 `headers.includes(a)`**([:160](lib/integration/erp/profiles/qianchuang-k3-v1.ts:160)) | 前 5 行取非空单元最多者([workbook.ts:33](lib/integration/erp/sources/kingdee/excel/workbook.ts:33)) |
| E3 RFQ 模板 | [lib/domain/rfq-excel.ts:9-28](lib/domain/rfq-excel.ts:9) | 无 | **写死表头字符串**,不走 `detectMapping` | 无 |

### E1 的 10 份各自为政的词表

[bom-parse.ts:43](lib/domain/bom-parse.ts:43)(8 字段)、
[supplier-quote-parse.ts:42](lib/domain/supplier-quote-parse.ts:42)(8)、
[supplier-offer-import.ts:45](lib/domain/supplier-offer-import.ts:45)(9)、
[recon-parse.ts:37](lib/domain/recon-parse.ts:37)(8)、
[po-bulk-input.ts:41](lib/domain/po-bulk-input.ts:41)、
[part-bulk-import.ts:24](lib/domain/part-bulk-import.ts:24)、
[trace-import.ts:41,56,69,87](lib/domain/trace-import.ts:41)(3 套模板)、
[alternate-bulk.ts:55](lib/domain/alternate-bulk.ts:55)、
[shortage-sheet.ts:43](lib/domain/shortage-sheet.ts:43)、
**[app/api/scrap/route.ts:15-25](app/api/scrap/route.ts:15) —— 词表直接写在 Route Handler 里**。

`mpn` 同义词条数:bom-parse **21** / supplier-quote-parse **11** / supplier-offer-import **6** /
recon-parse **6** / scrap route **4**。
**语义冲突**:`料号` 在 recon-parse、supplier-quote-parse 映射到 `mpn`,
在 [bom-parse.ts:66](lib/domain/bom-parse.ts:66) 映射到 `internalPn`。

三套**取值解析**规矩:supplier-quote-parse 用 `lib/providers/common/parse.ts`([:19](lib/domain/supplier-quote-parse.ts:19));
supplier-offer-import 自带 `num()`([:78](lib/domain/supplier-offer-import.ts:78));
rfq-excel 自带 `dec()`([:82](lib/domain/rfq-excel.ts:82))。

| 项 | 内容 |
|---|---|
| **测试缺口** | `column-mapping.ts` **零直接单测**(仅经消费方间接覆盖)—— 却是本轮要升级的基座 |
| **Canonical 目标** | `TabularColumnMapping`(引擎)+ 每域**声明式词表**(数据,不是代码);`ProviderResponseMapping` 另立 |
| **参考资产** | bom2buy `COLUMN_DICT`:10 字段 **113 别名(51 条含中文)**;两趟匹配**精确优先于子串**并带显式优先级序,专门防 `customer part number` 被 `part number` 抢走;`columnInference.ts` 按列内容采样 60 格做证据反查(`STRONG=0.7`),且**表头已明确的列受保护不被推翻**;`料号` 单独出现 = MPN,与 `型号/MPN` 并存时 = 内部料号(`INTERNAL_PN_WITH_MPN_PRESENT`)—— 恰好是本仓 D5 语义冲突的正解 |
| **不要抄的债** | bom2buy 在 `components/App.tsx:160-174` 本地重实现了 `findHeaderRow` 并 shadow 掉 import,被测版本在 UI 路径上是死代码 |
| **删除条件** | 各域词表迁为数据并有快照测试;`app/api/scrap/route.ts` 的内联词表移出路由;E2 保持独立(ERP profile 是合同契约,**不应**与 BOM 词表合并),但两者共用同一 `detectMapping` 语义或显式声明为何不共用 |

---

## D6 · 报价 / 阶梯价 —— **P0**

### 7 种 DTO

| # | 类型 | 位置 | 形状 |
|---|---|---|---|
| 1 | `NormalizedPriceBreak` | [normalized-offer.ts:23](lib/providers/common/normalized-offer.ts:23) | `{minQty: number, unitPrice: DecimalString}` |
| 2 | `ParsedOfferGroup.priceBreaks` | [supplier-offer-import.ts:67](lib/domain/supplier-offer-import.ts:67) | `{minQty: number, unitPrice: string}[]` |
| 3 | `ParsedQuoteBreak` | [rfq-excel.ts:61](lib/domain/rfq-excel.ts:61) | `{minQty: **string**, unitPrice: string, sourceRow}` |
| 4 | `NormalizedMaterialPrice` | [price-pool.ts:20](lib/domain/price-pool.ts:20) | `{minQty, maxQty, unitPrice}` —— **区间,不是阶梯** |
| 5 | `ParsedSupplierQuoteLine` | [supplier-quote-parse.ts:73](lib/domain/supplier-quote-parse.ts:73) | **单一 `unitPrice`,无阶梯** |
| 6 | `TierPrice` | [market-summary.ts:19](lib/domain/market-summary.ts:19) | `{qty, unitPrice, currency, provider}` |
| 7 | UI 本地 `PriceBreak` | [live-offers.tsx:6](app/(app)/materials/[mpn]/live-offers.tsx:6) | — |

### 3 种持久化 + 写入通道分叉(**这是真正的风险**)

同一业务事件"供应商报了个价",按**进入通道**落到互斥的模型:

| 通道 | 落库 | 位置 |
|---|---|---|
| RFQ 模板 Excel | `SupplierOffer` + `PriceBreak[]`(完整阶梯) | [rfq-supplier.ts:212-239](lib/server/repositories/rfq-supplier.ts:212) |
| 通用报价 Excel | `SupplierQuote` + `SupplierQuoteLine`(**单价,无阶梯**) | [procurement.ts:216-232](lib/server/repositories/procurement.ts:216) |
| 公开报价链接 | `SupplierOffer` + **恰好一条** `PriceBreak`(`minQty: moq ?? "1"`) | [supplier-action.ts:650-670](lib/server/repositories/supplier-action.ts:650) |
| 供应商预设 UI | `SupplierOffer` + `PriceBreak[]` | [procurement.ts:418-438](lib/server/repositories/procurement.ts:418) |

**后果**:价格池只读 `SupplierOffer`/`PriceBreak` 分支([price-pool.ts:128-167](lib/server/repositories/price-pool.ts:128)),
`SupplierQuoteLine` 的价格**永远进不了价格池**。走哪个通道报的价,决定了它是否参与成本矩阵。

另:`SupplierOffer` 的 schema 注释自称"NormalizedOffer 持久化"([schema.prisma:1706](prisma/schema.prisma:1706)),
但**两者之间没有任何 mapper 函数**。

| 项 | 内容 |
|---|---|
| **Canonical 目标** | 第七节的 `NormalizedOffer`(扩展现有 [normalized-offer.ts:30](lib/providers/common/normalized-offer.ts:30),**不新建**),外加显式 `NormalizedOffer ↔ SupplierOffer` mapper |
| **迁移方式** | 先补 mapper + 契约测试(旧写入路径不动)→ 四个通道逐个改为经 mapper 落库 → shadow 对比落库结果 → 最后统一读侧 |
| **删除条件** | 四通道收敛;`SupplierQuoteLine` 要么升级为阶梯、要么明确声明为"只读凭证不参与比价"并在 UI 标注 |

---

## D7 · 替代料评分 —— **P0,三套引擎**

| 系统 | 入口 | 评分模型 | 消费方 |
|---|---|---|---|
| **A** 四维 | `searchAlternates` [alternate-search.ts:88](lib/server/repositories/alternate-search.ts:88) | `technical/evidence/sourceTrust/confidence` 各 0–100 | [api/materials/[mpn]/alternates/route.ts:78](app/api/materials/[mpn]/alternates/route.ts:78)、finder/picker UI |
| **B** 采购排序 | `loadAlternates` [part-detail.ts:279](lib/server/repositories/part-detail.ts:279) | 单一 `score` 0–1 | 物料详情页 |
| **C** 三轴兼容 | [api/materials/alternates/route.ts:87](app/api/materials/alternates/route.ts:87) | 单一整数(万分制) | compat-panel、批量导入导出 |

**三张互相冲突的 source-trust 表**:

| 表 | 位置 | 值 |
|---|---|---|
| `SOURCE_TRUST` | [alternate-score.ts:55](lib/domain/alternate-score.ts:55) | LOCAL 1 / EZPLM .95 / DIGIKEY .9 / MOUSER .9 / AI_SEARCH .45 |
| `EVIDENCE_TRUST` | [alternate-compat.ts:244](lib/domain/alternate-compat.ts:244) | MANUAL 1 / EZPLM .95 / DIGIKEY .85 / MOUSER .85 / WEB .4 |
| `ORIGIN_WEIGHT` | [alternate-rank.ts:54](lib/domain/alternate-rank.ts:54) | LOCAL 1 / EZPLM .85 / DIGIKEY .8 / MOUSER .8 |

A 与 C 在 [alternate-compat.ts:26-28](lib/domain/alternate-compat.ts:26) 被声明为**有意并存**,
但两者之间没有任何映射;B 与 A 的候选检索逻辑则是**各写一遍**(见 D8)。

| 项 | 内容 |
|---|---|
| **Canonical 目标** | 第八/九/十节的 `modules/alternates/domain/*`,单一 `buildScoredCandidate()` |
| **删除条件** | 三系统的输出能互相解释(至少 A 的四维能推出 C 的三轴);souce-trust 合一;§十九 golden master 差异清零 |

---

## D8 · 候选结果对象构造 —— P1(altpart-pro 的教训已在本仓复现)

第十节点名的坑:"主循环和 rescue loop 禁止分别构造结果对象"。**本仓已经是这个状态**:

| 处 | 位置 | 特征 |
|---|---|---|
| 1–3 | [alternate-search.ts:169,222,244](lib/server/repositories/alternate-search.ts:169) | 三个来源各构造一次 CandidateSpec |
| 4–7 | [part-detail.ts:312,339,371,392](lib/server/repositories/part-detail.ts:312) | 四个来源各构造一次;`:312` 硬编码 `similarity: 1`,`:396` 硬编码 `0.9` |
| 8–10 | [alternate-rank.ts:152](lib/domain/alternate-rank.ts:152)、[alternate-compat.ts:216,224](lib/domain/alternate-compat.ts:216)、[alternate-search.ts:275,291](lib/server/repositories/alternate-search.ts:275) | ranked 结果两个分支各构一次 |
| 11 | [components/alternates/result-card.tsx:28-40](components/alternates/result-card.tsx:28) | UI **重新声明** `ScoredResult`,`verdict` 由联合类型放宽为 `string` |
| 12–13 | [alternate-selection.ts:31,95](lib/server/repositories/alternate-selection.ts:31)、[use-selections.ts:80,105](components/alternates/use-selections.ts:80) | **乐观 UI 行与持久化行的 `reasons` 字段不一致** |
| 14–15 | [api/materials/alternates/route.ts:58,189](app/api/materials/alternates/route.ts:58)、[export/route.ts:58](app/api/materials/alternates/export/route.ts:58) | `CompatibilityTriple` 构造三遍 |

**由此产生的实际缺陷(已证实)**:

1. `valuesFrom` 只填 `package`,其余一律 `null`([alternate-search.ts:141-153](lib/server/repositories/alternate-search.ts:141))
   → LOCAL 与 DIGIKEY 候选**永远只能拿到封装一项分数**,`technical` 等于封装分,`evidence` 等于封装权重。
2. `pinMapVerified` **全仓无生产写入方**(仅 [alternate-score.ts:98,214,227,238](lib/domain/alternate-score.ts:98) 读,
   唯一赋值在 [tests/unit/alternate-score.test.ts:74](tests/unit/alternate-score.test.ts:74))
   → 线上每个 PIN_TO_PIN 候选恒被警告并封顶 88。
3. 同理 `domestic` / `unitPrice` / `stock` 从无生产写入方 → `rankScored` 的 DOMESTIC 与 LOW_COST
   分支([alternate-score.ts:279-291](lib/domain/alternate-score.ts:279))**不可达**。
4. 去重键只有归一 MPN、**不含制造商**([alternate-search.ts:133](lib/server/repositories/alternate-search.ts:133)、
   [part-detail.ts:286](lib/server/repositories/part-detail.ts:286)、[bom-match.ts:371](lib/domain/bom-match.ts:371) 三份实现)
   → 同一 MPN 的两个厂商塌缩成先到的那个;而 [alternate-bulk.ts:76-77](lib/domain/alternate-bulk.ts:76)
   明确写着"一个 MPN 挂过 64 颗内部料"。

---

## D9 · Provider 工厂 / 缓存 —— P2

7 个工厂,无统一注册表:`getDigiKeyProvider`([digikey/index.ts:19](lib/providers/digikey/index.ts:19))、
`getMouserProvider`([mouser/index.ts:18](lib/providers/mouser/index.ts:18))、
`getEzplmPartsProvider`([ezplm/index.ts:20](lib/providers/ezplm/index.ts:20))、
`getMasterDataProvider`([master-data/index.ts:65](lib/providers/master-data/index.ts:65))、
`getErpProvider`([erp/index.ts:34](lib/providers/erp/index.ts:34))、
`getExcessProvider`([excess/factory.ts:16](lib/providers/excess/factory.ts:16))、
`getMesTraceProvider`([mes/index.ts:57](lib/providers/mes/index.ts:57))。

- `cached`/`cachedMode` memo **逐字复制三份**:[digikey/index.ts:16](lib/providers/digikey/index.ts:16)、
  [mouser/index.ts:15](lib/providers/mouser/index.ts:15)、[ezplm/index.ts:11](lib/providers/ezplm/index.ts:11)。
- `PROVIDERS_FORCE_MOCK` 只被 DigiKey/Mouser/ezPLM 三个工厂读取
  ([force-mock.ts:18](lib/providers/common/force-mock.ts:18)),ERP/Excess/MasterData/OCR **不读**。
- `getErpProvider` 对未知 vendor **静默回落 MockErpProvider**([erp/index.ts:64](lib/providers/erp/index.ts:64))
  —— 与"无凭据必须 NOT_CONFIGURED、禁止假成功"的纪律冲突,列入 REFACTOR_BACKLOG。
- Zod 校验机制两套:DigiKey/Mouser 走共享 `ProviderHttpClient`([http-client.ts:169](lib/providers/common/http-client.ts:169)),
  ezPLM **自己再实现一遍**([ezplm/http.ts:137,178](lib/providers/ezplm/http.ts:137));
  ERP Lab 有第三套 `DecimalStringSchema`([lab/contract.ts:16](lib/providers/erp/lab/contract.ts:16))。

---

## 附:REF-0 阶段不动的东西(点名保护)

这些是前三轮买来的纪律,重构时**只搬不改语义**:

- 公开 token 纪律([supplier-action.ts](lib/server/repositories/supplier-action.ts))、门户认证分域([portal-session](lib/auth/portal-session.ts))
- BOM 导入对账恒等式与 `RawBomRow` 原始行留痕([bom-import.ts:194-207](lib/server/repositories/bom-import.ts:194))
- ERP 同步状态机 / 幂等键永不换键([erp-sync.ts](lib/server/repositories/erp-sync.ts))
- 报价快照冻结与参数冻结守卫([quote.ts:208](lib/server/repositories/quote.ts:208))
- 否定式护栏([providers/common/parse.ts:156,201](lib/providers/common/parse.ts:156))与 `tests/unit/parse-negation.test.ts`
- 三层身份不合并(内部料号 ≠ MPN ≠ 客户料号)与 `PartMfgMapping` N:M 真源
- `UNKNOWN ≠ 0 ≠ 通过` 的三值纪律 —— 现有代码在 [param-compare.ts:32-36](lib/domain/param-compare.ts:32)、
  [similarity.ts:71](lib/domain/similarity.ts:71)、[alternate-bulk.ts:124-137](lib/domain/alternate-bulk.ts:124) 执行得**正确**,
  新引擎必须继承(唯一例外见 REFACTOR_BACKLOG 的 `PACKAGE_SCORE.UNKNOWN > DIFFERENT`)
