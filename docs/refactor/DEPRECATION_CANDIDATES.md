# DEPRECATION CANDIDATES — REF-0

> 基线:`main` @ `9de0409`。**REF-0 不删除任何东西。** 本文件只做分级与删除条件登记。
>
> 分级:
> - `ACTIVE` —— 在用,不动
> - `COMPATIBILITY` —— 为兼容保留,有继任者,迁移完成后可删
> - `LEGACY_REFERENCE` —— 只读参考资产,不删但可移出仓库
> - `ARCHIVE` —— 历史记录,永久保留(验收/审计对照)
> - `DELETE_AFTER_MIGRATION` —— 确认无 import / link / deployment 依赖后删

---

## 1. 目录级

| 项 | 大小 | 分级 | 依据 | 删除条件 |
|---|---|---|---|---|
| `legacy-static/` | 8.0 MB / 141 文件 | **LEGACY_REFERENCE** | 代码中仅 [nav-icon.tsx:3](../../components/shell/nav-icon.tsx) 一句注释引用;README 后半部分整段描述它 | **不删**。它是客户验收的视觉对照原件。建议移出仓库归档(单独 tag/附件),移出前确认设计 token 已全部落到 `app/globals.css` 与 `components/ui` |
| `reference/nestjs-v15/` | **目录不存在** | ARCHIVE(记录) | INTEGRATION_PLAN §九 2026-07-27 已确认"旧后端文件永久缺失,合并对照路径作废" | 无需动作;但 README / CLAUDE.md《权威文档》段仍列它 → 应加一句"已确认缺失" |
| `docs/design/` · `docs/customer-feedback/` | — | **ARCHIVE** | 验收对照原件 | 永久保留 |
| `tests/fixtures/customer-private/` | — | **ACTIVE(私有)** | gitignore 生效,零 git 跟踪 | 永不入库 |

---

## 2. 模块级 —— 零引用

| 文件 | 行 | 分级 | 证据 | 条件 |
|---|---|---|---|---|
| `lib/auth/token-verifier.ts` | 46 | **ACTIVE(预留钩子)** | 全仓零引用,**含测试** | **不删** —— CLAUDE.md「融合钉子 2」明文要求预留 JWT 验签适配器。但必须补一条单测:未配置 `EZPLM_JWT_PUBLIC_KEY` 时 `verify()` 返回 `null`,**绝不伪造通过**(当前这条纪律靠注释,无测试) |
| `lib/providers/fx/index.ts` | 166 | **ACTIVE(待外部输入)** | `convertAmount` 无生产调用方(仅 `tests/unit/fx-convert.test.ts`);`prisma.fxRate` 全仓从不被查询;`ErpProvider.pullExchangeRates` 已实现但拉到的 `ErpFxRate` 未接 `FxRate` 表 | **不删** —— 阻塞于 O3 汇率口径(BLOCKED_CUSTOMER)。**但必须先修一处不实注释**:[cost-matrix.ts:6-7](../../lib/server/repositories/cost-matrix.ts) 声称"跨币种需 FX 可换否则拒绝",而 `selectCost` 无任何币种检查 → 要么补检查,要么改注释(诚实 UI 纪律) |
| `lib/integration/erp/sources/kingdee/api/index.ts` | 70 | **ACTIVE(骨架)** | 仅 `tests/unit/kingdee-api-skeleton.test.ts` 引用 | **不删** —— 阻塞于 O1 金蝶 API 文档,属预期状态 |
| `components/ui/module-placeholder.tsx` | 37 | **DELETE_AFTER_MIGRATION** | `ModulePlaceholder` **零调用方**;但 [routes.test.ts:101-127](../../tests/unit/routes.test.ts) 仍拿"含该组件的页面集合"与 `implemented === false` 的集合做双向校验,而后者当前为**空集** | 与 REFACTOR_BACKLOG **R2-4**(routes.ts 拆分)一并处理:确认占位页机制是否还需要,若不需要则同时删组件与该测试断言 |

---

## 3. API 端点 —— 21 个孤儿(UI 与测试皆无调用)

| 端点 | 分级 | 说明 |
|---|---|---|
| `agent-approvals/[approvalId]` | **ACTIVE(缺 UI)** | **不删** —— 这是人工确认闭环的落点,缺的是 UI(REFACTOR_BACKLOG R0-6)。当前还带一个 P0 字段抹除缺陷(R0-4) |
| `materials/parts/[partId]/mfg-mappings` | **ACTIVE(R4 新建)** | R4-3 交付,UI 接线属 PARTIAL 项 |
| `procurement/rfqs/[prfqId]/quote-upload` | **COMPATIBILITY** | 与 `procurement/rfq/[id]/quotes` 功能重叠但写**不同的表**(R0-7 的一支) |
| `procurement/orders/lines/[lineId]/resolve` | **COMPATIBILITY** | 与 `procurement/lines/[lineId]/resolve` 同结构同枚举;**且无角色守卫** |
| `reconciliation/lines/[lineId]/resolve` | **COMPATIBILITY** | 同上,枚举不同;**无角色守卫** |
| `bom/import/[jobId]/stream` | 待定 | SSE 进度端点,轮询路径在用 → 确认 SSE 是否仍是既定方案 |
| `erp/conflicts/[conflictId]/resolve` · `erp/connections/[id]/jobs` | 待定 | 有 E2E 覆盖,无 UI |
| `materials/parts/[partId]/classify` · `.../review` | 待定 | 有权限守卫,无 UI |
| `procurement/historical-price` · `supplier-recommendation` · `supplier-strategy` · `rfqs/[prfqId]/{rfq-excel,supplier-lines}` · `supplier-offers/[offerId]/review` | 待定 | R4-6/R4-7 交付面,UI 接线属 PARTIAL |
| `procurement/orders/[poId]`(GET)· `.../lines`(PUT)· `ecn/[ecnId]`(PUT)· `ecn/[ecnId]/notices` · `bom/version/[versionId]/cost-matrix` · `settings/nre-items` | 待定 | — |

**统一删除条件**:逐个确认无外部调用方(**含客户系统、RPA 脚本、门户**)后才可删。
本仓有对外集成面,`grep` 仓内零命中**不等于**无人调用 → 需业务侧确认。

**仅测试调用(非孤儿,但需登记)**:`rfq/[id]/attachments`(旧上传端点,代码里自己指明了继任者
[route.ts:39](../../app/api/rfq/[id]/attachments/route.ts))、`materials/compliance`、`materials/tags`、
`erp/jobs/[jobId]/lines`、`settings/{ops-health,part-code-rules,tenant}`、`portal/inventory`、
`traceability/{analysis,lot-ops,substitutions}`、`cron/*`。

---

## 4. 数据模型 / 字段级

| 项 | 分级 | 证据 | 条件 |
|---|---|---|---|
| `Part.mpn` | **COMPATIBILITY** | R4 起降级为"首选缓存",真源是 `PartMfgMapping`;同步受 `whyCannotSyncPreferredMpn` 守卫 | 长期保留(读路径多);不得作为真源使用 |
| `PartAlternate.grade`(自由文本) | **COMPATIBILITY** | [schema.prisma:1535](../../prisma/schema.prisma);值如 `完全替代`/`条件替代`;**从不参与评分**,与三轴枚举并存 | REF-4 决定:映射进 `ReplacementLevel` 或显式标记为历史列 |
| `Part.rohs` / `Part.reach` | **COMPATIBILITY** | PR-F 有意保留(PRODUCTION_HARDENING_REPORT §二:"旧字段一律保留…两者并存"),新逻辑读 `PartComplianceDeclaration` | 确认无读路径后删;当前**不动** |
| `AgentRun.idempotencyKey` / `writtenRefs`;`AgentStep.startedAt/finishedAt`;`AgentEvidence.stepId`;`AgentApproval.stepId` | **ACTIVE(应写而未写)** | 全部已声明、有 `@@unique`,但 `persistAgentRun` 从不赋值 | **不删,要补写**(REFACTOR_BACKLOG R1-13)。`idempotencyKey` 不写导致重复 POST 产生重复 run 与重复审批卡 |
| `JobStatus.PARTIAL_SUCCESS`(在 Agent 语境) | **ACTIVE(未使用)** | LLM 失败被记为 `SUCCEEDED` | R1-13 修复时启用 |
| `AgentType.TRACE` | **待对齐** | Prisma 枚举有,TS `AgentTypeValue` 无 | 二选一:补 TS 或移除枚举值 |
| `ErpSyncJob` ↔ `IntegrationSyncRecord` 双状态机 | **ACTIVE(有意并存)** | ROUND2_AUDIT §3.2 决策"扩展而非另起" | **不删**;但两套 API + 两套权限语义需收敛(R1-10) |

---

## 5. 配置 / 依赖 / 分支

| 项 | 分级 | 条件 |
|---|---|---|
| `@prisma/client: ^7.9.0` 的 caret | **DELETE_AFTER_MIGRATION**(改为精确) | 与 `prisma` / `@prisma/adapter-pg` 的 `7.9.0` 对齐;改后复测 `install` / `migrate` / `generate`(国内镜像可安装性是硬需求) |
| 20+ 条陈旧本地分支 `feat/f1-*`…`feat/pr-a-*` | **DELETE_AFTER_MIGRATION** | `git branch --merged main` 确认后 `-d` |
| `docs/round2-docs.zip`(未跟踪)· `docs/customer-feedback/*.docx`(未跟踪) | 待定 | 工作区里未跟踪的两项 —— 归档或加入 gitignore,不要长期悬着 |
| `docs/SPEC.md` · `KICKOFF_PROMPTS.md` · `SCHEMAMERGEMAP.md`(停在 2026-07-27) | **ARCHIVE** | 不删(验收基线),但建议在文件头标注"基线文档,最后更新 2026-07-27" |
| 环境变量 | **ACTIVE** | 56 个全部有引用点,未发现死变量 |

---

## 6. 死代码扫描方法与局限(供复核)

扫描方式:对 `lib/` 与 `components/` 下每个文件,搜索 `@/<path>` 形式的绝对导入 **与** `./<basename>` 形式的相对导入;
再对可疑项逐个按导出符号名复查。

**局限,复核时请注意**:
- 目录索引导入(`@/lib/providers/digikey` 命中 `index.ts`)会让 `index.ts` 看似无引用 → 已逐个复核排除;
- 相对导入(`components/shell/app-shell.tsx` 用 `./sidebar`)会让组件看似无引用 → 已复核,`sidebar`/`topbar`/`global-search`/`nav-icon` **均在用**;
- 动态 `import()` 与字符串拼接路径**未覆盖** → 删除前应再跑一次全文 `grep` 符号名;
- API 端点的"无调用方"只覆盖本仓 → **不能据此推断外部无人调用**。

---

## 7. 本轮结论

**REF-0 不删除任何内容。** 真正可以安全删除的只有 3 类,且都排在 REF-10:
① `@prisma/client` 的 caret;② 已合并的本地分支;③ 迁移完成且确认零调用方的 compatibility 端点与旧实现。

其余"看起来是死代码"的东西,复核后大多是**有意预留**(SSO 钩子、FX、金蝶骨架)或**缺 UI 而非缺代码**
(Agent 审批端点)—— 这类不是删除对象,是接线对象。
