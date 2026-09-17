# MIGRATION PLAN — REF-0 → REF-10

> 基线:`main` @ `9de0409`。
> **最高原则**:保留现有功能、UI、数据库数据与公开行为;先建测试和兼容层;渐进迁移;最后删旧实现。
> **禁止一次性 rewrite。**

---

## 0′. 决策记录(2026-09-17,已确认)

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 是否插入 REF-0.5(P0 修复)与 REF-0.8(对拍基建) | ✅ **接受**。序列见 §1 |
| 2 | 线下 Excel 录入的供应商报价是否参与比价 | ✅ **已定:参与,且与 API 报价同权**。方案 A,依据与配套约束见 [CUSTOMER_FEEDBACK_2026-09-17.md §3](CUSTOMER_FEEDBACK_2026-09-17.md) —— 决定性依据是客户产品自述"回复会作为报价参与寻源竞争",以及 API 不可靠时线下价是必须能用的兜底 |
| 3 | `legacy-static/` 去留 | ✅ **归档移出仓库**,已执行(PR #88);仓外副本 + `archive/legacy-static-last` 标签双路径可取回 |

同日收到客户对前期版本 BOM2BUY 的三份测试反馈,已逐条对本仓库核实并并入 backlog(新增 7 项),
其中 **R0-8(零价格守卫)升为 P0** 并入 REF-0.5;**P0-1 升为最高优先级**(客户要求匹配率 95+%)。

---

## 0. 本计划与来函 PR 序列的两处偏差(已确认接受)

来函给的顺序是 REF-0 → REF-1(Identity+Registry)→ … → REF-10。审计后建议**两处微调**:

### 偏差 1:在 REF-0 与 REF-1 之间插入 **REF-0.5(P0 修复)**

**理由**:审计确认 4 个 P0 正确性缺陷当前在线(CJK 键失配 / 量纲不比 / 候选只填封装 / 审批抹字段)。
第十九节的 Golden Master 要求"旧实现 vs 新实现,差异只允许两种:明确修复旧 bug、人工批准的新规则"。
如果带着未修的 P0 进入 REF-1,对拍结果里会同时出现"重构引入的差异"和"本来就是错的",
**无法归因,门禁形同虚设**。先把 P0 修掉并用回归用例钉死,REF-1 的对拍基准才干净。

REF-0.5 的每一项都小、独立、可回滚,且各自带一条回归用例(见 REFACTOR_BACKLOG R0-1…R0-7)。

### 偏差 2:在 REF-1 之前插入 **REF-0.8(测试与对拍基建)**

**理由**:`lib/server/repositories/` 的 **38 个文件中 35 个在 `tests/` 里零引用**,
整层的安全网只有 E2E。没有 shadow-run 与对拍框架,第十九节的 Golden Master 无从执行 ——
"先建立测试和兼容层"这条原则在当前代码状态下**不是一句口号,是硬前置**。

REF-0.8 交付:① `tests/shadow/` 对拍框架;② `lib/domain/column-mapping.ts` 的直接单测(REF-2 的基座,当前零测);
③ 现有 UAT / Golden 夹具固化为可复用输入集;④ feature flag 基建。

---

## 1. 调整后的 PR 序列

| PR | 内容 | 前置 | 迁移风险 | schema |
|---|---|---|---|---|
| **REF-0** ✅ | 架构审计(#87,**不改生产代码**) | — | 无 | 无 |
| **REF-0.5** ✅ | P0 修复 + 回归用例(#89 #90)(R0-1…R0-6 + **R0-8 零价守卫**;R0-7 先补失败用例,实施在 REF-3) | REF-0 确认 | 低 | 无 |
| **REF-0.8** ✅ | 对拍/shadow 基建 + 缺失基座单测 + flag 基建(#91) | REF-0.5 | 无(只加测试与脚手架) | 无 |
| **REF-1** | Canonical Part Identity + Manufacturer Registry | REF-0.8 | **高**(归一键变化) | 别名 seed + key 重算 |
| **REF-2** | BOM Normalization V2(参考 bom2buy) | REF-1 | 高 | 无 |
| **REF-3** | Supplier Mapping V2 + NormalizedOffer 收敛 | REF-1 | 高(含 R0-7) | 待定,需商务确认 |
| **REF-4** | Alternate Engine V2(参考 altpart-pro) | REF-1、REF-0.5(R0-2/R0-3) | 高 | 无 |
| **REF-5** | BOM Matching / Sourcing 共用 Identity + Offer | REF-2、REF-3 | 中 | 无 |
| **REF-6** | Application / Repository 分层 | REF-0.8 | 中(可逐 context) | 无 |
| **REF-7** | API Namespace 收敛 | REF-6 | 中 | 无 |
| **REF-8** | Agent Runtime 统一 | REF-0.5(R0-4/R0-6) | 低 | 无 |
| **REF-9** | Route / Feature / Permission / Scope 分离 | — (可与 REF-6 并行) | 低 | 无 |
| **REF-10** | Prisma 归属文档 / 依赖固定 / 弃用删除 | 全部 | 低 | 无 |

**REF-9 可与 REF-6 并行**(改的是配置与类型归属,不碰数据流);其余严格串行。

---

## 2. Golden Master 迁移机制(每个模块迁移时的标准动作)

```
                  ┌──────────────┐
   input ────────▶│ OldImpl      │────▶ 生产结果(用户看到的)
        │         └──────────────┘
        │         ┌──────────────┐
        └────────▶│ NewImpl      │────▶ 仅记录,不影响用户
                  └──────────────┘
                         │
                         ▼
                  Compatibility Report(逐字段 diff)
```

**差异只允许两类**:① 明确修复的旧 bug;② 人工批准的新规则。**其它差异一律阻止 flip。**

### Feature flags —— **已实现**([lib/domain/refactor-flags.ts](../../lib/domain/refactor-flags.ts))

| flag | 环境变量 | 覆盖 | 默认 |
|---|---|---|---|
| `PART_IDENTITY_V2` | `REFACTOR_PART_IDENTITY_V2` | REF-1 | off |
| `BOM_NORMALIZER_V2` | `REFACTOR_BOM_NORMALIZER_V2` | REF-2 | off |
| `SUPPLIER_MAPPING_V2` | `REFACTOR_SUPPLIER_MAPPING_V2` | REF-3 | off |
| `ALTERNATE_ENGINE_V2` | `REFACTOR_ALTERNATE_ENGINE_V2` | REF-4 | off |

**放在租户设置还是 env?** —— 定为 **env 级**(部署期开关),不进 `TenantSettings`:
这些是迁移期脚手架,不是业务功能开关,不应污染租户配置面,也不应出现在设置 UI 上。
迁移完成即连同旧实现一起删除。

判定纪律:默认全关;只认 `1/true/on/yes`(大小写不敏感);**认不出的值一律当关**
并标 `UNRECOGNIZED_OFF` 保留原值 —— 拼错的开关不该表现得和"没设"一模一样。

### 对拍框架 —— **已实现**([lib/domain/shadow-compare.ts](../../lib/domain/shadow-compare.ts))

```ts
const { result } = await shadowRun({
  label: "bom:standard/standard-cn.csv",
  old: () => oldImpl(input),   // 生产结果;它抛错原样抛出
  next: () => newImpl(input),  // 只记录;抛错不外溢
});
// result 永远是 old 的结果 —— 行为不变
```

- `diffValues` 深度逐字段比较,结果按 path 排序(报告可复现);
- **默认脱敏**:diff 只含字段路径与类型/长度摘要,不含值内容(R4 §4);
  需要看值时显式 `redact: false`,且只在本地;
- 截断显式上报 `total` / `truncated` —— 不让人以为"只有这么点差异";
- `summarizeShadowRuns` 给出 `topPaths` 与 `readyToFlip`;
  **`NEXT_FAILED` 同样阻断 flip** —— 没有差异不等于跑通了。

输入语料由 [tests/shadow/corpus.ts](../../tests/shadow/corpus.ts) 统一枚举
(与金样套件共用同一份发现逻辑,新增夹具两边同时覆盖);
框架在真实语料上的自检见 `tests/golden/shadow-harness.golden.test.ts`,
它同时是 REF-1..REF-4 的现成模板 —— 把 `next` 换成 V2 实现即可。

### 每个模块的迁移四步

1. **建新实现 + 兼容 adapter**。旧函数改 `@deprecated` 薄包装转调新实现(签名不变)——
   这一步保证"当前 BOM / Provider / Alternate UI 不需要一次全部改写"。
2. **shadow run**。旧版作为生产结果,新版后台同时计算,逐字段记 diff。
3. **对拍清零**。差异归零或逐条人工批准,写入 Compatibility Report。
4. **flip flag → 观察 → 删旧实现**。删除前 `grep` 确认零调用方。

### 三类不能用对拍验证的改动(必须另行处理)

| 类型 | 例子 | 处理 |
|---|---|---|
| 归一键变化 | REF-1 的 `manufacturerPartNoKey` | 对拍**加一条 SQL 侧重算校验**:TS 规则与 PG 规则在同一样本集上逐一等价 |
| 写入通道合并 | REF-3 的 R0-7 | 先补 mapper + 契约测试,**旧写路径完全不动**;逐通道切换,每通道单独 PR |
| 有意修正的 bug | REF-0.5 全部 | 不对拍,改为"回归用例先红后绿" |

---

## 3. 参考仓库的使用纪律

**禁止直接 copy 整目录。必须:理解规则 → 转成 TypeScript → 适配 Canonical Types → 增加单元测试 → 符合 tenant/audit/provider 纪律。**

### 采用什么

| 来源 | 采用的规则 | 落点 |
|---|---|---|
| bom2buy `normalizer.ts` | 列字典两趟匹配(**精确优先于子串** + 显式优先级序,防 `customer part number` 被 `part number` 抢走);表头行按可映射单元数打分;Value/MPN 判别的分层否定过滤;`料号` 单独=MPN、与 `型号/MPN` 并存=内部料号;"宁可漏掉也不猜"(短 token 不推断) | REF-2 |
| bom2buy `references.ts` | 位号:全角分隔符、`-~–—…` 范围符、前缀不一致不展开、`MAX_RANGE_SPAN` 护栏、**原始串必须保留**、`compactReferences` 回折;厂商:52 标准名/112 别名(**42 条中文**)、收购归并、域名第二索引、未知只清洗不猜 | REF-2 / REF-1 |
| bom2buy `packageNormalize.ts` | 英制↔公制对照(**0402 英制 = 1005 公制**,搞反选错尺寸)、53 标准 IC 封装/170 查找键、KiCad 命名为 canonical | REF-2 |
| bom2buy `fieldMap.ts` | 供应商字段集与路径映射语言、`isMapUsable` 就绪门、价格阶梯升序 + 非正价剔除、**缺失 ≠ 0** | REF-3 |
| altpart-pro `quantity.js` | QuantityIR:SI 前缀表(µ/μ/u 三写法)、16 量纲、**KB/MB 十进制 vs KiB/MiB 二进制严格区分**、`comparable()` 要求同量纲、`NA_RE` 未知不作 0 | REF-4 |
| altpart-pro `comparison-semantics.js` | 10 种比较语义及各自 pass/fail/unknown 规则;条件参数 `@` 解析、条件不同时**夹到 55 并标记人工核对**而非直接失败 | REF-4 |
| altpart-pro `scoring-node.js` | 四维分开不压成单分;三条 confidence 上限;**无 pin map 证据永不 DIRECT_REPLACEMENT**;`pinVerified` fail-closed(`ai_pinout` 不算权威);7 级 replacement level 的判定顺序 | REF-4 |
| altpart-pro `rule-profiles.js` | 模式=确定性门而非只改提示词;`{pass, downgrade}` 三态(未知降级不淘汰);权重提升的 `max(base*mul, n*(mul/maxMul))` 修正 | REF-4 |
| altpart-pro `part-identity.js` | requested identity 不被模糊结果静默替换;缓存键 = MPN + **标准化后**厂商 + 封装;变体亲缘分级;资源 identity guard | REF-1 |

### 明确不采用什么

| 参考仓的债 | 为什么不采 |
|---|---|
| bom2buy 在 UI 组件里重实现 `findHeaderRow` 并 shadow 掉 import | 被测版本成了死代码 —— 本仓已有同类风险(§D5 的 10 份词表) |
| bom2buy 别名表为模块级全局常量、由副作用装配、**无租户概念** | 本仓的租户别名分域 + 人工批准 + ezPLM 为真源**优于**参考仓,不得倒退 |
| bom2buy 任意 4 位码一律当英制、无标记 | 静默错分,违反本仓"未知不猜"纪律 |
| bom2buy 供应商映射只能来自 env、无法按租户存储与版本化 | 与多租户底座冲突 |
| altpart-pro 全量无类型 JS、`QuantityIR` 是可选字段袋 | 改为判别联合 `{kind:'unknown'|'text'|'scalar'|'range'}` |
| altpart-pro **对源码文本做断言的测试** | 重排代码即失败、改坏代码仍通过 —— 只移植其**行为意图** |
| altpart-pro 死的第二套单位引擎 `units.js`(与 `quantity.js` 在 KB/KiB 上矛盾) | 正是本仓要消灭的那类重复 |
| altpart-pro 两套互不调和的分类体系、按品牌名子串判国别(含一条乱码条目) | 只取其三态"未知不淘汰",不取表 |
| altpart-pro 无租户/审计/人工确认/无引擎版本戳 | 本仓的 AuditLog、人工确认闭环、快照冻结是硬约束 |

**冲突时优先保留本仓的**:tenant isolation、AuditLog、human confirmation、data sovereignty、provider abstraction。

---

## 4. 每个 PR 的质量门禁(不得降级)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm exec prisma validate
```

- 涉及 UI:`pnpm test:e2e`
- 涉及 BOM:`pnpm test:golden` **和** `pnpm test:uat:qianchuang`
- 涉及归一键:TS 规则 ↔ PG 规则等价性单测

**禁止**:只做 grep 自检;只做 TypeScript 编译;用 README 声称测试通过。
**必须**提供真实终端输出摘要 —— 按 CLAUDE.md《收尾汇报固定格式》:
① 四项门禁执行结果原文;② 每个修复缺陷对应的回归测试名;③ 已完成/未完成清单;④ Preview URL 或本地验证说明。

> CI 现状(不改):`prisma generate → validate → lint → typecheck → test → test:golden → build →
> migrate deploy → e2e`。`test:uat:qianchuang` 因依赖私有夹具**不在 CI**,须本地执行并在 PR 描述中贴出摘要。

---

## 5. 隐私与安全纪律(贯穿全程,沿用 R4 §4)

迁移过程中同样适用,**不因为是重构就放松**:

- 禁止 commit 原始客户 Excel;禁止把真实名称写入公开 Golden;禁止把真实行输出到 CI log;
  禁止把完整 ERP row 放进 AuditLog;禁止把真实采购关系暴露到公开 artifact。
- 对拍报告(Compatibility Report)如果基于真实夹具,**只输出聚合计数与差异类型,不输出行内容**。
  本次审计中"521 条非 ASCII MFG_PN"即按此口径产出(只计数,未打印任何真实值)。
- 私有夹具目录与 `uat-reference-overrides.json` 保持 gitignore。

---

## 6. 回滚策略

| PR 类型 | 回滚方式 |
|---|---|
| 纯代码 + flag | 关 flag,旧实现仍在生产路径 → 秒级回滚 |
| 含迁移 | 迁移全部设计为**纯增量、nullable、不动历史行**(沿用 PRODUCTION_HARDENING_REPORT §二的既有纪律);`prisma migrate resolve --rolled-back` |
| 归一键重算 | 重算迁移必须**可重入**(幂等),且保留重算前的键值列一个版本周期 |
| 写入通道合并(REF-3) | 每通道单独 PR,单独回滚;合并期间两套模型并存 |

---

## 7. REF-0 的结论

REF-0 已完成:5 份文档就位,42 项 backlog 分级,4 个 P0 定位到行并用真实数据量化。
**未改一行生产代码,未动 schema,未删文件,未改 UI。**

**三件待决事项已全部确认**(见 §0′),REF-0 闭环。

同日并入客户 BOM2BUY 测试反馈后的**下一步**:从 **REF-0.5** 开工,范围为
R0-1(CJK 键失配)/ R0-2(量纲)/ R0-3(候选参数)/ R0-4(审批抹字段)/ R0-5(租户守卫)/
R0-6(Agent 端点守卫)/ **R0-8(零价守卫)**,外加 R0-7 的先红失败用例。

**REF-0.5 内部建议顺序**:R0-1 → R0-8 → 其余。
R0-1 直接决定匹配率(客户验收要求 95+%),R0-8 直接对应客户已实测撞到的现象 —— 两者都是**验收面**,
其余是工程面。

仍需**业务/客户**答复、不阻塞开工的:客户反馈 Q1–Q6(见 [CUSTOMER_FEEDBACK_2026-09-17.md §2.1](CUSTOMER_FEEDBACK_2026-09-17.md)),
其中 Q4「审核与冻结」建议直接采用本仓库既有的报价状态机定义答复。
