# ROUND 3 PRODUCTION READINESS AUDIT

> 基准:main @ `d6b2eb04f8bf386e33a6c29127a64ed96d0e5feb`(Merge PR #66)。
> 所有结论以该 SHA 的实际代码为证据,不引用文档记忆。
> 本文件为审计产物,随 Round3 首个 PR 提交。

## Executive Summary

Round2 交付的功能面完整且纪律良好(token/快照/幂等/诚实 UI 均有真实实现与测试),
但**三个疑似 P0 全部在代码上坐实**:门户库存全量拉取后应用层过滤、公开接口限流是进程内
Map、门户登录审计把邀请人记成登录者。三者共同点:**单实例演示环境下正确,生产多实例 +
真实数据量下失效或产生错误证据**。此外 ECN 审批链读实时配置(评审中改配置会改历史链)、
影响分析缺 coverage 语义、门户开户直发密码,均属"能工作但不适合生产"。

问题按性质分三类:

| 类别 | 条目 |
|---|---|
| **代码没做** | 门户邀请流、CALL_MATERIAL/RFQ_QUOTE 确认、Transactions/Lots 合约、correlationId、golden 安全矩阵、主仓的 Lab 快照管理客户端 |
| **代码已做、外部没接** | 金蝶 API(O1)、Excess 真实数据(O2)、SMTP 发送(O4)、ERP_LAB/APP_PUBLIC_URL/门户三组环境变量(部署配置即通) |
| **能工作但不适合生产规模** | P0-A 全量库存拉取、P0-B 单实例限流、P0-C 审计 actor 语义、ECN 审批链未冻结、门户直发密码开户 |

---

## P0

### P0-A · 门户库存:全量拉取 ERP 后应用层过滤,无分页 —— 确认存在

- **Current behavior**:`portalInventory()` 调 `provider.pullInventory(target.config, {})`(空参 = 无 cursor/limit),拿到**整个租户**的库存行后在应用层 `.filter(customerCode === ...)`,全部返回,无分页。
- **Evidence**:[lib/server/portal.ts:104-112](lib/server/portal.ts) —— `const { items } = await provider.pullInventory(target.config, {});` → `.filter((i) => norm(i.customerCode) === norm(customer.code))`。`PullInput` 已有 `cursor/limit/since`([lib/providers/erp/types.ts:229-234](lib/providers/erp/types.ts))但**没有 customerCode**;Lab 端 `PullOptions` 同样只有 `updatedSince/cursor/limit`。
- **Risk**:真实 ERP 库存数十万行时,每次门户页面加载 = 全量拉取(内存/带宽/ERP 配额);数据最小化原则失守 —— 门户请求在传输层拿到了全租户数据,只靠应用层一行 filter 挡住。将来接真实金蝶绝不能全量拉。
- **Severity**:P0
- **Recommended fix**:①`PullInput`/Lab `PullOptions` 增 `customerCode?`(**扩展现有类型,不建第二套**);② Provider 侧过滤:Lab 服务端按 customerCode 过滤 + 分页;③ 应用层保留二次校验(defense-in-depth);④ Provider 不支持 server-side filter 时经 capability 显式声明,**禁止静默回落全量**;⑤ 门户接口带 cursor/limit(上限如 200/页);⑥ 契约测试锁 customer scope;⑦ Lab 仓库同步实现(独立 PR)。
- **Migration required?** 否(纯代码 + Lab 仓库改动)。
- **Customer information required?** 否。
- **Can fix now?** 是(R3-2 + Lab 仓库配套 PR)。
- **Regression tests needed?** 客户 A 改 query/cursor/materialCode/手工调 API 均取不到客户 B 数据;分页游标越界;capability 缺失时的显式报错。

### P0-B · 公开接口限流:进程内 Map,多实例不共享;x-forwarded-for 可伪造 —— 确认存在

- **Current behavior**:`lib/server/rate-limit.ts` 用模块级 `const buckets = new Map()` 做滑动窗口;`clientIp()` 直接取 `x-forwarded-for` 第一段。消费方:门户登录(10/min)与供应商确认(30/min)。
- **Evidence**:[lib/server/rate-limit.ts:7,27](lib/server/rate-limit.ts);[app/api/portal/auth/login/route.ts:18](app/api/portal/auth/login/route.ts);[app/api/confirm/[token]/route.ts:25](app/api/confirm/[token]/route.ts)。
- **Risk**:① Railway/Vercel 水平扩容后各实例独立计数,N 实例 = N 倍限额,"以为限了流"而实际没有;② `x-forwarded-for` 第一段是**客户端可控**的(客户端自带该头时,代理通常是追加而非覆盖首段)—— 攻击者轮换伪造 IP 即绕过 per-IP 限流;③ 桶满 FIFO 逐出可能误逐活跃 key。设计文档(F3/F6 检查点 A)已如实标注单实例兜底,但生产必须升级。
- **Severity**:P0
- **Recommended fix**:①`RateLimitProvider` 接口 + `MemoryRateLimitProvider`(dev/test)+ **PostgreSQL-backed provider**(生产;项目现无 Redis,不为此引重依赖 —— 单表 upsert 计数 + 窗口过期,写量低频公开端点完全够用);Upstash 作可选 provider 留接口;② IP 解析改为「可信代理跳数」模型:取 `x-forwarded-for` **从右往左数第 N 个**(N = `TRUSTED_PROXY_HOPS` 环境变量,Railway=1),或直连时用 socket 地址;文档写明部署模型;③ 部署文档标明 WAF/边缘限流为第一道、应用为第二道。
- **Migration required?** 是(限流计数表,纯增量)。
- **Customer information required?** 否。
- **Can fix now?** 是(R3-1)。
- **Regression tests needed?** login/confirmation 暴力尝试、multi-key、窗口过期、未知 IP、IPv6、伪造 proxy header 不改变计数键、双实例语义(用两个 provider 实例共库模拟)。

### P0-C · 审计 actor 归因错误:门户登录记到邀请人、供应商响应记到链接创建人 —— 确认存在

- **Current behavior**:`AuditLog.userId` 为必填 string,无 actorType。门户登录写 `userId: account.invitedById`;供应商免登录响应写 `userId: req.createdById`(两处都有代码注释自认权宜)。
- **Evidence**:[app/api/portal/auth/login/route.ts:37](app/api/portal/auth/login/route.ts) `userId: account.invitedById`;[lib/server/repositories/supplier-action.ts:262,362](lib/server/repositories/supplier-action.ts) `userId: req.createdById`;[prisma/schema.prisma AuditLog](prisma/schema.prisma)(3424-3438 行,无 actorType)。
- **Risk**:审计证据被污染 —— 按 userId 检索会把外部主体的行为归到内部员工头上;发生争议时"谁干的"答错人。实际来源虽记录在 `after.respondedVia`/`after.email`,但**索引维度(userId)是错的**。
- **Severity**:P0(证据完整性)
- **Recommended fix**:AuditLog 增量扩展(全部 nullable,向后兼容):`actorType`(INTERNAL_USER/PORTAL_ACCOUNT/SUPPLIER_LINK/SYSTEM/INTEGRATION,缺省视为 INTERNAL_USER)+ `actorId` + `actorDisplay`。`writeAudit` 增可选参数;门户登录/供应商响应改为 `actorType=PORTAL_ACCOUNT/SUPPLIER_LINK`、`actorId=portalAccountId/requestId`,`userId` 保留为"关联内部责任人"语义并在注释写明。历史行不动。
- **Migration required?** 是(AuditLog 三列 nullable,纯增量)。
- **Customer information required?** 否。
- **Can fix now?** 是(R3-1)。
- **Regression tests needed?** 门户登录审计不得归因到 inviter(锁 actorType/actorId);供应商响应审计 actorType=SUPPLIER_LINK;内部操作缺省不变。

---

## P1

### P1-1 · ECN 审批链读实时配置,workflow 未随提交冻结

- **Current behavior**:`decideStage()` 每次审批时读**当前** `TenantSettings.ecnReviewStages`;`releasedSnapshot` 含 approvals 但不含 workflow 定义。阶段顺序固定(工程→采购→管理),只能启停前两段,不是可配置列表。
- **Evidence**:[lib/server/repositories/ecn.ts:244](lib/server/repositories/ecn.ts) `const cfg = await stageConfig(session.tenantId)`(位于 decideStage 内);snapshot 构造(320 行起)无 stages 字段。
- **Risk**:评审进行中改租户配置会**改变在途 ECN 的审批链**(如停用采购段 → 正在等采购的单直接跳到管理);历史 ECN 无法回答"当时的审批链是什么"。
- **Severity**:P1
- **Recommended fix**:① `Ecn` 增 `workflowSnapshot Json?`(提交评审时冻结当时的启用阶段序列);`decideStage`/详情页读快照而非实时配置;退回重提时重新冻结;② 配置模型升级为**有序阶段列表**(`ecn.approvalStages`,元素为阶段标识,MANAGEMENT 必须收尾、校验兜底),阶段基于职责/permission 语义,不加 QUALITY 角色(枚举不动);未来客户确认品质评审时只改配置。releasedSnapshot 一并带上 workflow。
- **Migration required?** 是(Ecn.workflowSnapshot 一列,纯增量;TenantSettings 为 Json 无迁移)。
- **Customer information required?** 否(QUALITY 是否加入仍在待商务池,本改动恰好为它留了配置位)。
- **Can fix now?** 是(R3-5)。
- **Regression tests needed?** 提交后改配置不影响在途单;快照进 release 冻结;非法配置(去掉 MANAGEMENT)被拒。

### P1-2 · 影响分析缺 coverage 语义

- **Current behavior**:`SourceResult` 只有 `state: ok|not_configured|error`;工单卡全量口径只靠卡片标题一句话说明,数字本身可能被当成"精确影响面"。
- **Evidence**:[lib/server/repositories/ecn-impact.ts:16-22](lib/server/repositories/ecn-impact.ts);工单卡标题见 impact-panel.tsx。
- **Recommended fix**:`SourceResult` 增 `coverage: FULL|PARTIAL|HEADER_ONLY|UNAVAILABLE` + `warning`;各源如实标注(BOM=FULL、库存/PO/呆滞=FULL、工单/销售订单=HEADER_ONLY、成本=UNAVAILABLE);面板按 coverage 渲染徽标,HEADER_ONLY 的数字明示"不可直接作决策依据"。
- **Migration?** 否。**Customer info?** 否。**Can fix now?** 是(R3-5)。**Tests**:coverage 逐源断言。

### P1-3 · 门户开户直发密码,无邀请流/状态机/停用接口

- **Current behavior**:管理层 POST email+password(服务端 hash)直接建号;`active` 布尔仅有,无 INVITED 状态、无 `passwordChangedAt`、无停用/重置 API(GET+POST 之外无 PATCH)。
- **Evidence**:[app/api/settings/portal-accounts/route.ts:15,42](app/api/settings/portal-accounts/route.ts);PortalAccount 模型无 status/passwordChangedAt。
- **Risk**:管理员知道客户初始密码且需线下传递;无法审计"客户何时改过密码";账号停用只能动库。
- **Recommended fix**:邀请流(沿用 F3 token 纪律:hash 入库/过期/单次/撤销/404 防枚举):管理层建邀请 → 复制一次性链接(SMTP 未配不显示"已发送")→ 客户自设密码 → ACTIVE。`PortalAccount` 增 `status(INVITED/ACTIVE/DISABLED)` + `passwordChangedAt`(增量,现有账号回填 ACTIVE);补停用/重置接口。不做自注册/OAuth/SSO。
- **Migration?** 是(增列 + 邀请表或复用 SupplierActionRequest 模式新建 PortalInvite;纯增量)。**Customer info?** 否。**Can fix now?** 是(R3-3)。**Tests**:邀请单次性/过期/撤销;直发密码路径下线;停用即时生效(会话守卫已查 active)。

### P1-4 · 供应商确认缺口:CALL_MATERIAL / RFQ_QUOTE

- **Current behavior**:枚举含四种 kind,公开路由只处理 PO_CONFIRM/OPO_ETA([app/api/confirm/[token]/route.ts:37,44](app/api/confirm/[token]/route.ts));另两种无创建接口(设计上防死链,DEFERRED 已如实标注)。
- **Evidence**:同上;复用对象全部存在:`ShortageSheet`(2097)/`CallMaterialRecord`(2156)/`SupplierOffer`(1473)/`SupplierQuote`(1678)。
- **Recommended fix**:CALL_MATERIAL:token 页填 Can Supply/Qty/ETA/Note → 回填既有 CallMaterialRecord;RFQ_QUOTE:token 页报价表(unit price/currency/MOQ/SPQ/LT/validity/note)→ 落既有 SupplierOffer(经既有校验管线)。**不建平行模型**。初步核对 SupplierOffer 字段面覆盖上述七项(offers 管线本就吃这些维度);若发现缺 validity 字段先报告再动。
- **Migration?** 待字段核对,预计否或极小。**Customer info?** 否。**Can fix now?** 是(R3-4)。**Tests**:两场景匿名闭环 + 回填断言 + 重放。

### P1-5 · ERP 快照就绪度:Lab 已具备,主仓缺管理客户端

- **Current behavior**:**ERP Lab 独立仓库真实存在且已部署**(`gongyueetree/ezplm-erp-lab` @ `bab70d4`,https://ezplm-erp-lab.vercel.app,健康检查通过)。Lab 侧已有:客户脱敏 Excel 快照导入(`server/customer-snapshot-import.ts`,乾创文件格式启发式)、`MappingProfile`、`ImportReport.brokenReferences`、数据集 version 字段、通用导入的引用校验。主仓 `HttpErpLabProvider` 只实现 12 个数据操作,**没有** getDataset/快照导入转交/映射状态/数据集选择的客户端。
- **Evidence**:Lab 仓 types.ts:214/227/247;主仓 [lib/providers/erp/lab/index.ts](lib/providers/erp/lab/index.ts) 无 snapshot/mapping/dataset 方法。
- **Risk**:乾创给脱敏 Excel 后,操作动线是"去 Lab 网页上传" —— 主仓集成状态页看不到数据集版本/映射状态/引用断裂报告,联调过程不可观测。
- **Recommended fix**:主仓增 Lab 管理客户端(getDataset/健康/快照导入代理或引导链接)+ 集成状态页展示数据集名/版本/种子时间/映射概况/断裂引用计数;**不在主仓重复实现 Simulator DB**。金蝶继续 WAITING_FOR_DOCUMENTATION。
- **Migration?** 否。**Customer info?** 需要乾创脱敏 Excel 才能真实演练(BLOCKED_CUSTOMER 的是"演练",不是"开发")。**Can fix now?** 是(R3-6)。**Tests**:契约镜像扩 dataset 形状;未配置 env 的诚实空态。

### P1-6 · 集成可观测性:无 correlationId,诊断链不闭合

- **Current behavior**:IntegrationSyncRecord 有 state/attemptCount/lastAttemptAt/nextRetryAt/externalId/errorCode/errorMessage(状态页已展示),但无 correlationId;业务动作 → 同步记录 → Provider 请求 → Lab requestLog 之间无法串。幂等键全文存库(状态页未展示,泄露面小,但日志纪律未成文)。
- **Evidence**:schema IntegrationSyncRecord 无 correlation 字段;grep 全仓无 correlationId。
- **Recommended fix**:增 `correlationId`(nullable),写回路径生成并透传到 Lab 请求头(Lab requestLog 已有 requestId 可对齐);状态页展示;明文纪律:日志/审计禁 password/SMTP/ERP token/raw token(现状抽查合规,补一条单测扫描审计 payload 关键词)。
- **Migration?** 是(一列 nullable)。**Customer info?** 否。**Can fix now?** 是(R3-8)。

### P1-7 · 门户 Transactions/Lots 无 Provider 合约

- **Current behavior**:两页为诚实空态 shell;ErpProvider 与 Lab 合约均无 movements/lots 拉取。
- **Evidence**:grep types.ts 无 Transaction/Lots 方法;页面文案"数据源待接入"。
- **Recommended fix**:ErpProvider + Lab 镜像增 `pullInventoryMovements` / `pullInventoryLots` 规范合约(Lab 供测试数据,金蝶 NOT_IMPLEMENTED);门户按 capability 区分「数据源暂未接入」与「0 条记录」(现状已区分,合约接上后语义延续)。
- **Migration?** 否(Lab 仓需建表,独立 PR)。**Customer info?** 字段最终口径待客户,但合约可先行。**Can fix now?** 是(R3-7)。

---

## P2

- **P2-1 门户登录跨租户 email 歧义**:`findFirst({email, active})` 无租户维度 —— 同一 email 在两个租户开户时命中任意其一([app/api/portal/auth/login/route.ts:24](app/api/portal/auth/login/route.ts))。修法:登录按 email 查全部命中,密码逐一比对或全局唯一化 email(推荐后者 + 迁移前置检查)。
- **P2-2 登录可枚举边缘**:未知邮箱 → 401 通用话术;已存在但租户 flag 关闭 → 404 —— 两种响应可区分出"账号存在"。修法:flag 关闭时也回 401 通用话术(env 关闭仍 404)。
- **P2-3 Excess golden 夹具先行于管线**:excess.golden.test.ts 只锁 manifest 格式,自我标注"导入管线尚不存在" —— 诚实但属"fixture 比功能快"。随 Excess 真实接入(O2)收敛,或并入 R3-6 快照链路。
- **P2-4 golden 安全矩阵缺位**:租户/客户隔离目前只在 E2E(data-scope-prod、f6 隔离矩阵),golden 层无 TENANT_A/B、CUSTOMER_A/B fail-closed 场景(R3-8)。
- **P2-5 限流桶 FIFO 逐出**:超 1 万 key 时可能逐出活跃计数(rate-limit.ts:19-22)—— 随 P0-B 的 provider 化一并消失。

---

## Already Good — Do Not Rewrite

- **公开 token 纪律**(F3):hash-only、条件更新防重放、404 防枚举、最小字段(E2E 断言无单价)—— R3-3 邀请流直接沿用此模式。
- **门户认证域分离**:独立 cookie/密钥/载荷互斥,密钥误配同值仍互拒(单测锁定);API 守卫逐请求查 active。
- **DTO 白名单**:PortalInventoryRow 类型上不存在价格/供应商字段位。
- **ERP 同步状态机**:14 场景矩阵、幂等键永不换键、NETWORK_DROP 重放取回原单、条件更新抢占 —— 不动。
- **金样基座**(F5):构造期望、生产管线断言、CI 必过门;已抓出 3 个真缺陷。
- **租户隔离基建**:tenantWhere/tenantData 全覆盖;E2E data-scope 断言在。
- **ECN 核心**:状态守卫/快照冻结/Apply to BOM 二次确认/VOIDED 可溯 —— R3-5 只动 workflow 冻结与 coverage,不重写状态机。
- **诚实 UI 全线**:NOT_CONFIGURED ≠ 0、Mock 标注、Excel 兜底并列。

## External / Customer Blocked

| 项 | 状态 | 阻塞什么 |
|---|---|---|
| 金蝶 API 文档/测试账号(O1) | BLOCKED_CUSTOMER | Kingdee 真实联调;骨架已就位 |
| Excess 样表(O2)/ 汇率口径(O3) | BLOCKED_CUSTOMER | Excess 真实管线与 FX 数值 |
| SMTP 密码 + 端口/多账号(O4/N2/N3) | BLOCKED_CUSTOMER | 真实发信(草稿链已在) |
| N1 DCC 规则 / N5 回执口径 / N6 AR-AP 样表 | BLOCKED_CUSTOMER | 各自流程定稿 |
| ERP_LAB_BASE_URL/TOKEN、APP_PUBLIC_URL、CUSTOMER_PORTAL_ENABLED+PORTAL_AUTH_SECRET | BLOCKED_EXTERNAL(部署配置) | 配置即通,代码已备 |
| 脱敏 ERP Excel 快照 | BLOCKED_CUSTOMER(演练);开发不阻塞 | R3-6 的真实数据演练 |

## Proposed PR Sequence

采纳来函的 R3-1…R3-8,微调两处:

1. **R3-1 公开面安全加固**(P0-B + P0-C + P2-2/P2-5 + 日志脱敏单测)
2. **R3-2 门户数据范围 + 分页**(P0-A + P2-1;含 Lab 仓库配套 PR:服务端 customerCode 过滤与分页)
3. **R3-3 门户邀请流**(P1-3)
4. **R3-4 供应商确认补全**(P1-4;先做 SupplierOffer 字段核对,不足先报告)
5. **R3-5 ECN workflow 冻结 + Impact coverage**(P1-1 + P1-2)
6. **R3-6 ERP 快照就绪**(P1-5 + P2-3 收敛;主仓只做客户端/展示,不复制 Simulator)
7. **R3-7 门户 Transactions/Lots 合约**(P1-7;含 Lab 仓库配套)
8. **R3-8 可观测性 + golden 安全矩阵**(P1-6 + P2-4)

微调理由:R3-1 在 R3-2 之前 —— 限流与审计 actor 是**当下已暴露**的公开面风险;R3-2 需要 Lab 仓库联动,把两仓 PR 排成一对。

## Schema Migration Impact

全部**纯增量、nullable、不动历史行**:

| PR | 迁移 |
|---|---|
| R3-1 | AuditLog +actorType/actorId/actorDisplay(nullable);限流计数表(新表) |
| R3-3 | PortalAccount +status/+passwordChangedAt;PortalInvite 新表(或等价) |
| R3-5 | Ecn +workflowSnapshot Json? |
| R3-8 | IntegrationSyncRecord +correlationId |
| R3-2/4/6/7 | 预计无(R3-4 待 SupplierOffer 字段核对) |

## Security Findings

按严重度:P0-B(限流失效面 + IP 伪造)> P0-C(审计证据污染)> P0-A(数据最小化失守,现有 filter 仍挡住越权读,属规模/原则问题而非当下泄露)> P2-1/P2-2(登录歧义与枚举边缘)。现有防线里**没有发现跨租户/跨客户的实际越权读写路径**;E2E 隔离矩阵与 tenantWhere 覆盖有效。

## ERP Lab Readiness

Lab 仓库**真实存在且在线**:`gongyueetree/ezplm-erp-lab` @ `bab70d4`,Vercel 部署健康(databaseReachable=true),含快照导入(乾创格式启发式)、MappingProfile、断裂引用报告、14 场景、WO/SO(LAB-1)。缺口在**主仓侧**:无数据集/映射/导入状态的客户端与展示(P1-5)。乾创脱敏 Excel 到位后,现有 Lab 已能吃进去;主仓补客户端后整条链在集成状态页可观测。

## Test Gaps

- 限流:暴力/多 key/过期/IPv6/伪造 header/双实例语义(R3-1)
- 审计 actor:门户登录不得归因 inviter(R3-1)
- Provider 分页与 customer scope 契约测试;客户 A 永取不到 B(R3-2)
- 邀请 token 单次/过期/撤销(R3-3)
- ECN workflow 冻结回归(R3-5)
- golden 安全矩阵 TENANT_A/B、CUSTOMER_A/B fail-closed(R3-8)
- 幂等重试矩阵已有(F4),补 correlation 贯通断言(R3-8)

## Recommended First PR

**R3-1 Public Surface Security Hardening**。理由:公开面(门户登录、供应商确认)是当前唯一无需登录即可触达的攻击面,限流失效 + IP 伪造 + 审计归因错误三者叠加在同一面上;修复不依赖任何客户信息、迁移纯增量、与后续 PR 无耦合。R3-2 紧随其后(需 Lab 仓库配套,提前准备双仓 PR)。
