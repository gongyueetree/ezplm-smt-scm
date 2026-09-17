# DEPENDENCY MAP — REF-0

> 基线:`main` @ `9de0409`。边数由 `from "@/…"` 静态导入统计得出(不含相对导入与动态 import)。

---

## 1. 层间依赖边(实测条数)

```
                     ┌─────────────────────────────────────────────┐
                     │  app/(app)/**/page.tsx   (54 页 / 3 layout)  │
                     └───┬──────────┬──────────┬─────────┬─────────┘
            235 │components   136 │lib/server   57 │lib/domain   31 │repositories
                ▼                  ▼(含 db)          ▼                ▼
      ┌──────────────┐   ⚠ 34 个页面直连 Prisma    11 │lib/providers  ⚠
      │ components/  │                                  ▼
      └──────┬───────┘
             │
                     ┌─────────────────────────────────────────────┐
                     │  app/api/**/route.ts            (153 路由)   │
                     └─┬────────┬────────┬────────┬────────┬───────┘
              348 │server  109 │repos  72 │domain  9 │auth  8 │providers  2 │agents
                  ▼            ▼          ▼
                          ⚠ 59 个路由直连 Prisma

                     ┌─────────────────────────────────────────────┐
                     │  lib/server/repositories/        (38 文件)   │
                     └─┬────────┬────────┬────────┬────────┬───────┘
              111 │server  59 │domain  38 │providers  35 │repos↺  4 │integration
                                                         ⚠ 仓储互相调用

                     ┌─────────────────────────────────────────────┐
                     │  lib/domain/                     (83 文件)   │
                     └──────────────┬──────────────────────────────┘
                                 12 │lib/providers   ⚠ 域层不纯
                                    ▼
                     ┌─────────────────────────────────────────────┐
                     │  lib/providers/                             │
                     └──────────────┬──────────────────────────────┘
                                  3 │lib/server      ⚠⚠ 依赖倒置
                                    ▼
                          lib/server/db · tenant-scope · tenant-settings
```

### 完整边表(≥2 条)

| From | To | 边数 | 评价 |
|---|---|---|---|
| app/api | lib/server | 348 | 正常(含 `api.ts`/`session.ts` 等工具) |
| app/page | components | 235 | 正常 |
| **app/page** | **lib/server** | **136** | ⚠ 其中 34 个文件直连 `db` |
| lib/repositories | lib/server | 111 | 正常 |
| app/api | lib/repositories | 109 | 正常(目标形态) |
| app/api | lib/domain | 72 | 可接受(纯函数) |
| lib/repositories | lib/domain | 59 | 正常 |
| **app/page** | **lib/domain** | **57** | 可接受,但说明页面在做业务判断 |
| lib/repositories | lib/providers | 38 | 正常(集成边界在仓储层) |
| **lib/repositories** | **lib/repositories** | **35** | ⚠ 仓储互调 = 缺失的 use case 层 |
| **app/page** | **lib/repositories** | **31** | ⚠ 页面越过路由直接编排 |
| app/page | lib/other | 28 | `lib/routes`/`lib/rbac`/`lib/format` |
| lib/metrics | lib/server | 16 | ⚠ `lib/metrics` 是第二数据访问层 |
| **lib/domain** | **lib/providers** | **12** | ⚠ 域层不纯(4 处 value 导入) |
| **app/page** | **lib/providers** | **11** | ⚠ 页面直调 Provider |
| lib/providers | lib/providers | 10 | 正常 |
| app/api | lib/auth | 9 | 正常 |
| app/api | lib/providers | 8 | ⚠ 含比价业务逻辑住在路由 |
| lib/server | lib/domain | 7 | 正常 |
| lib/metrics | lib/domain | 7 | 正常 |
| components | lib/other | 7 | `lib/routes` 为主 |
| **lib/providers** | **lib/server** | **3** | ⚠⚠ **依赖倒置** |
| lib/repositories | lib/integration | 4 | 正常(R4 新层) |
| app/api | lib/agents | 2 | 正常 |
| lib/integration | lib/providers / lib/domain | 各 1 | 正常 |

---

## 2. 违反分层的具体位置

### 2.1 ⚠⚠ `lib/providers` → `lib/server`(依赖倒置,3 处)

```
lib/providers/excess/factory.ts:8   import { prisma } from "@/lib/server/db";
lib/providers/excess/factory.ts:9   import { tenantWhere } from "@/lib/server/tenant-scope";
lib/providers/master-data/index.ts:21 import { getTenantSettings } from "@/lib/server/tenant-settings";
```

Provider 层本应是**最外层适配器**,现在反向依赖应用的持久化与租户设置。
`excess/factory.ts` 更进一步:**靠探测数据库里有没有数据来决定返回哪个 Provider**
([:16](../../lib/providers/excess/factory.ts))。

### 2.2 ⚠ `lib/domain` → `lib/providers`(域层不纯,11 行 / 8 文件)

**值导入(真实运行期耦合,4 处)**:

```
lib/domain/supplier-quote-parse.ts:19  parseLeadTimeDays, parseMoneyString, parseQuantity
lib/domain/offers.ts:9                 manufacturerMatches
lib/domain/bom-match.ts:15             ProviderError
lib/domain/bom-match.ts:16             manufacturerMatches, normalizeMpn
```

**类型导入(较轻,7 处)**:`sourcing.ts:11`、`market-summary.ts:15`、`bom-validate.ts:7`、
`alternate-rank.ts:17`(均为 `NormalizedOffer`/`LifecycleValue`)、
`bom-match.ts:13,14,17`(`EzplmPartsProvider`/`DistributorProvider`/`LifecycleValue`)。

**最严重的一个**:[lib/domain/bom-match.ts](../../lib/domain/bom-match.ts) 把 `DistributorProvider`
实例放进自己的 context,并**在域层直接发起外部调用**
(`d.getOffersByMpn(...)`,[:497-501](../../lib/domain/bom-match.ts)),再把 offer 映射成自己的 `MatchCandidate`([:504-521](../../lib/domain/bom-match.ts))。

**另外 1 处 Prisma 耦合**:`lib/domain/part-mfg.ts:14` 从 `@prisma/client` 导入(枚举类型)。

> 注:`lib/domain` **没有任何文件导入 `@/lib/server/*`** —— 这条边界守住了。

### 2.3 ⚠ 页面直调 Provider(11 处)

```
app/(app)/settings/page.tsx:5-7                    ezplmProviderMode / digiKeyMode / mouserMode
app/(app)/materials/page.tsx:4-6                   同上
app/(app)/quality/page.tsx:5                       getMesTraceProvider, traceGranularityNote
app/(app)/settings/integrations/status/page.tsx:6  fetchLabDatasetSummary
app/(app)/materials/[mpn]/library-preview.tsx:5    type PartDocument
app/(app)/bom/[bomId]/page.tsx:8                   type LifecycleValue
app/(app)/bom/version/[versionId]/page.tsx:15      type LifecycleValue
```

前四条是值导入。`*Mode()` 只读环境态用于"诚实 UI"徽标 —— 语义合理,但应经查询服务暴露。

### 2.4 ⚠ 业务逻辑住在 Route Handler(12 个)

| 路由 | 行 | 住在里面的东西 |
|---|---|---|
| `search` | 215 | 10 个跨模型查询 + 命中映射 |
| `materials/alternates` | 206 | 查询 + 搜索过滤 + 排序 + compat 重组 + 写路径 |
| `reconciliation/example` | 182 | 构建 XLSX + 在事务里播种整张对账单 |
| `procurement/rfq/[id]/compare-export` | 150 | 4 处 Prisma + 双重循环 + XLSX 成形 |
| `shortage/lines/[lineId]/call` | 135 | 状态校验 + 联系人选择 + 邮件正文拼装 + 事务 |
| `settings/portal-accounts/[id]` | 134 | 两条手写 update 流 |
| `materials/alternates/bulk-import` | 181 | 逐行校验与落库循环 |
| `auth/register` | 179 | 租户/用户/角色创建事务 |
| `shortage/sheets` | 149 | 4 处 Prisma + 装配循环 |
| **`procurement/rfq/[id]/sourcing`** | 107 | **整个 sourcing use case** |
| `procurement/supplier-recommendation` | 86 | 整个推荐 use case |
| `bom/version/[versionId]/manufacturing` | 98 | 手写 update-or-create |

### 2.5 ⚠ 仓储互调(缺失 use case 层的症状,35 条边)

```
alternate-search.ts:30  → part-detail
erp-sync.ts:26          → erp-connection
supplier-action.ts:28   → integration-sync
integration-worker.ts:24→ integration-sync
uat-import.ts:20        → part-mfg-mapping
quote.ts:29             → cost-matrix
```

并且:**`SessionRef`(每个 repository 都接收的会话类型)从 `rfq.ts` 导出**,
被约 20 个仓储 `import type { SessionRef } from "./rfq"` —— 一个业务仓储成了平台类型的宿主。

---

## 3. Prisma 访问分布

| 桶 | 文件数 |
|---|---|
| `app/**/page.tsx` + `layout.tsx` | **34** / 57 |
| `app/api/**/route.ts` | **59** / 153 |
| `lib/server/repositories/` | 37 / 38 |
| `lib/server/` 其它 | 5 |
| `lib/metrics/` | 8 |
| `lib/providers/excess/factory.ts` | 1 |
| `scripts/` | 3 + 3(自建 client) |
| `tests/` | 3 |
| **合计导入 `db` 的文件** | **150** |

写操作 246 处:create 112 / update 52 / updateMany 33 / upsert 25 / createMany 12 /
deleteMany 11 / delete 1。
`tenantWhere` 641 处、`tenantData` 206 处、**`assertTenantScopedMutation` 运行期 0 处**。

---

## 4. 模块耦合热点(6 个月提交次数)

| 提交数 | 文件 | 为什么热 |
|---|---|---|
| **51** | `prisma/schema.prisma` | 单文件 125 model —— 每个特性都要改它 |
| **23** | `lib/routes.ts` | 十种职责合一(见 §5) |
| **21** | `lib/domain/demo-reset-plan.ts` | **每新增一张表都必须在此登记**,否则 `verifyPlanCoverage()` 拒跑 |
| 12 | `app/(app)/materials/page.tsx` | |
| 11 | `lib/server/repositories/bom-import.ts` | |
| 8 | `lib/providers/erp/types.ts` / `bom-parse.ts` / `api/bom/import/route.ts` / 5 个页面 | |

`demo-reset-plan.ts` 的强耦合是**有意设计**(注释明确:"不允许沉默的第三类"),
属于**正确的**耦合 —— 列在这里只为说明 schema 拆分时它必须同步。

---

## 5. `lib/routes.ts` 的十种职责(第十四节要拆的那个)

450 行,33 个路由条目(6 个分区 / 23 个顶层 / 10 个子项):

| # | 职责 | 唯一读者 |
|---|---|---|
| 1 | 路由路径注册 | sidebar、page-header、导航算法、测试 |
| 2 | 菜单结构(两级) | sidebar |
| 3 | 菜单呈现(`label`/`icon`/`ai`) | sidebar、page-header、module-placeholder |
| 4 | 交付计划元数据(`plannedPr`,16 种取值) | sidebar 徽标、module-placeholder、routes.test 正则 |
| 5 | 功能状态(`implemented`) | sidebar、`unimplementedRoutes()` → shell E2E + 文件系统对账 |
| 6 | RBAC 角色可见性(`roles`,30 处) | **仅 `lib/rbac.ts`** |
| 7 | 细粒度权限(`permission`,**仅 1 处**:`/quality` → `quality.view`) | **仅 `lib/rbac.ts`** |
| 8 | 占位页文案(`desc`,含多段业务决策说明) | page-header、module-placeholder |
| 9 | 导航算法(`flattenRoutes`/`findRoute`/`parentPath`/`backTarget`/`breadcrumbFor`) | topbar、page-header |
| 10 | **全站 `RoleName` 枚举** | **14 个与导航无关的模块**(session、permissions、ecn、po-status、quote-status、rfq-status、search-scopes…) |

**拆分依据已经由读者分布给出**:`roles`/`permission` 只有 rbac 读;`desc`/`plannedPr` 只有两个 UI 组件读;
`RoleName` 被 14 个模块读且**不需要文件里其它任何东西**。

**当前状态数据**:`implemented: true` × 16、`implemented: false` × **0**、缺省 × 17 →
`unimplementedRoutes()` 返回 **空数组**;而 `ModulePlaceholder` 组件**已无调用方** ——
第 5 项职责已空转。

**注册表与文件系统脱节**:33 个注册条目 vs **54 个 `page.tsx`**。
未注册的 21 个含所有详情页(`/bom/[bomId]`、`/materials/[mpn]`、`/quotes/[versionId]`…)、
`/login`、`/register`、`/confirm/[token]` 与全部 6 个 `/portal/*`。

---

## 6. 权限 / 功能开关的并行编码

### 权限 —— 6 套并存

| # | 机制 | 位置 | 规模 |
|---|---|---|---|
| 1 | `PERMISSIONS` + 三层解析(角色默认→PermissionGrant→UserPermission) | [lib/auth/permissions.ts:17-128](../../lib/auth/permissions.ts) | 23 条权限 |
| 2 | 角色→菜单可见性 + **MANAGEMENT 全局旁路** | [lib/rbac.ts:26-35](../../lib/rbac.ts)(旁路在 `:32`,**在权限检查之后**) | — |
| 3 | **路由内联角色检查** | `roles.some(r => r === …)` | **153 个路由中 54 个** |
| 4 | `requirePermission` | [lib/server/permissions.ts:45](../../lib/server/permissions.ts) | **仅 27 个路由** |
| 5 | 行级数据范围矩阵 | [lib/domain/data-scope.ts:50](../../lib/domain/data-scope.ts) | **`:42` 又本地重声明了一份 `RoleName`** |
| 6 | 中间件路径豁免 | [middleware.ts:11-22,70-72](../../middleware.ts) | `api/upload`、`api/bom/import` 自守 |

**实际被路由强制执行的权限字符串只有 12 种**
(`erp.connection.view`×6、`material.create`×6、`trace.view`×3、`trace.import`×3、
`erp.connection.manage`×2、`material.review`×2、`settings.permissions.manage`×2、`trace.analyze`×2,
`erp.mapping.manage`/`erp.sync.execute`/`trace.containment.approve`/`trace.containment.propose` 各 1)。

**`quality.*` 权限在任何路由中都未被强制** —— [api/quality/route.ts](../../app/api/quality/route.ts) 无权限守卫,
而 [routes.ts:292](../../lib/routes.ts) 却用 `quality.view` 门住**页面**。页面门住了,API 没有。

### 功能开关 —— 3 套并存

1. **租户 flag**:[tenant-settings.ts:15-26](../../lib/domain/tenant-settings.ts) 5 个
   (`bom.versionGraph`/`bom.manufacturingInfo`/`ecn.impactAnalysis`/`ecn.customerNotice`/`customerPortal`),
   服务端在 3 个路由强制。
2. **环境变量**:`CUSTOMER_PORTAL_ENABLED`,与租户 flag **取与**([portal.ts:27-31](../../lib/server/portal.ts))。
   全仓**无 `FEATURE_*` 风格变量**,其余 env 都是凭据/配置。
3. **`routes.ts` 的 `implemented`/`plannedPr`** —— 第三种"这个功能开了吗",与租户 flag 完全独立,
   且**没有任何路由条目引用租户 flag**。

### 搜索范围 —— 2 份手工同步,且**已经不一致**

[rbac.ts:49-55](../../lib/rbac.ts) `SEARCH_SCOPES`(中文标签)与
[search-scopes.ts:37-45](../../lib/domain/search-scopes.ts) `ROLE_ENTITIES`(可执行实体)。
文件自述"两者必须同源变化",单测锁标签相等 ——
但 `SUPPLIER` 在 rbac 是 `["OPO(本供应商)"]`、在 search-scopes 是 `[]`。

---

## 7. 外部依赖

生产依赖 15 个,克制(无图表库、无 ORM 之外的数据层、无状态管理库):
`next ^15.3` · `react ^19` · `@prisma/client ^7.9.0` · `@prisma/adapter-pg 7.9.0` · `zod ^4.4.3` ·
`decimal.js ^10.6` · `exceljs ^4.4` · `jose ^6.2.4` · `bcryptjs ^3.0.3` · `nodemailer ^9.0.5` ·
`@vercel/blob ^2.6.1` · `pdfjs-dist ^6.2.108` · `three ^0.185.1` · `occt-import-js` · `dotenv`

**版本漂移(第十七节要求固定的)**:

```
prisma              7.9.0    ← 精确
@prisma/adapter-pg  7.9.0    ← 精确
@prisma/client     ^7.9.0    ← ⚠ caret,可漂到 7.x 任意小版本
```

三者必须完全一致(INTEGRATION_PLAN §九 记录了固定 7.9.0 的原因:
7.9.1 的引擎依赖国内镜像未同步,客户生产走国内主机,可安装性是硬需求)。
当前 `@prisma/client` 的 caret 使这条约束**可以被 `pnpm update` 静默打破**。

---

## 8. 环境变量清单(56 个)

| 类别 | 变量 |
|---|---|
| 核心 | `DATABASE_URL` `AUTH_SECRET` `NODE_ENV` `APP_PUBLIC_URL` `APP_TIMEZONE` `NEXT_PUBLIC_BASE_PATH` `BUILD_STANDALONE` |
| ezPLM | `EZPLM_API_BASE_URL` `EZPLM_API_KEY` `EZPLM_JWT_PUBLIC_KEY` `EZPLM_FILE_HOST_SUFFIXES` |
| DigiKey | `DIGIKEY_CLIENT_ID` `DIGIKEY_CLIENT_SECRET` `DIGIKEY_API_BASE_URL` `DIGIKEY_ACCOUNT_ID` `DIGIKEY_CURRENCY` `DIGIKEY_SITE` `DIGIKEY_LANGUAGE` |
| Mouser | `MOUSER_API_KEY` `MOUSER_API_BASE_URL` |
| AI | `AI_PROVIDER` `ANTHROPIC_API_KEY` `ANTHROPIC_MODEL` `ANTHROPIC_API_BASE_URL` `GEMINI_API_KEY` `GEMINI_MODEL` `GEMINI_API_BASE_URL` |
| ERP Lab | `ERP_LAB_BASE_URL` `ERP_LAB_ACCESS_TOKEN` `ERP_CREDENTIAL_KEY` |
| 门户 / 安全 | `CUSTOMER_PORTAL_ENABLED` `PORTAL_AUTH_SECRET` `CRON_SECRET` `TRUSTED_PROXY_HOPS` `RATE_LIMIT_PROVIDER` `SELF_REGISTRATION_TENANT_SLUG` |
| 邮件 | `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASSWORD` `SMTP_FROM` |
| 存储 | `FILE_STORAGE_PROVIDER` `FILE_STORAGE_DIR` `BLOB_READ_WRITE_TOKEN` `ATTACHMENT_MAX_MB` |
| 测试 / 工具 | `PROVIDERS_FORCE_MOCK` `QIANCHUANG_UAT_FIXTURE_DIR` `SMOKE_MPN` `SMOKE_MFR` `SMOKE_QTY` `NEW_PASSWORD` `NEW_PASSWORD_FILE` |

`.env.example` 存在。未发现 `FEATURE_*` 开关(功能开关走租户设置,见 §6)。
