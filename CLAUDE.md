# CLAUDE.md — ezPLM SMT 供应链协同系统(Next.js 全栈重构)

本文件是本仓库的最高工作约束。每次会话开始先确认已理解本文件;与任何临时指令冲突时,以本文件为准并向人类提出冲突。

## 项目背景(一段话)
将已通过三轮诊断加固的静态原型(见 `legacy-static/`)重构为 Next.js 全栈交互系统。合同甲方/系统使用方=乾创电子(苏州);平台品牌=硬禾科技 ezPLM;联创科技等仅为示例数据中的下游客户。商业结构="一套代码两种交付":Vercel 做开发/预览,客户生产用同一 Docker 镜像部署国内主机。本系统独立部署、多租户,经 API 消费 ezPLM 本体数据,将来可作独立产品外销。

## 权威文档(实施前必读)
- `docs/SPEC.pdf` — GPT《Next.js 全栈重构实施规范》,PR1–PR9 的功能基线(首个会话先将其转写为 `docs/SPEC.md` 便于后续引用)
- `docs/INTEGRATION_PLAN.md` — 升级整合方案:架构决策、资产迁移地图、客户需求→PR 映射(§3)、与 ezPLM 融合策略(§7)
- `docs/customer-feedback/` — 客户测试的功能清单 xlsx 与逐页意见 docx(验收对照原件)
- `legacy-static/` — 静态原型(仅视觉与业务逻辑参考,禁止继续修改)
- `reference/nestjs-v15/` — 旧后端 Prisma schema(42 表),PR1 需产出与规范模型的合并对照表

## 硬性约束(违反即返工)
1. Next.js App Router + React + TypeScript;Server/Client Components + Route Handlers;PostgreSQL + Prisma。
2. 所有价格、GTB、Markup、PPV、人工费、总价由**确定性 TypeScript 函数**计算,禁止 LLM 直接计算数值。
3. AI(Vercel AI SDK + Claude)只生成建议与草稿;正式匹配、供应商选择、报价审批、ERP 输出**必须人工确认**;写工具须确认卡片,读工具可自动。
4. 每个写操作记录 tenantId、userId、时间与 AuditLog;所有业务表带 tenantId,update/delete 必须 tenant scoped。
5. API Key 仅存服务端环境变量;禁止浏览器暴露;禁止爬虫访问 DigiKey/Mouser,只用官方 API。
6. 外部数据只经 Provider 接口(EzplmPartsProvider / DigiKeyProvider / MouserProvider);无真实 Key 时用 Mock,**严禁在代码、注释、汇报中声称 Mock 已完成真实联调**。
7. 可部署 Vercel,也可 Next.js standalone Docker;`basePath` 可配置,静态资源相对引用。
8. 本阶段不实现:完整品质、PPAP、RMA、SN 追溯、高级 APS、完整 ECN、实时爬虫——留 feature flag/backlog;范围变更一律进"待商务确认"池,不得默默吸入。

## 与 ezPLM 本体的融合钉子(现在就做,事后补极痛)
- 业务代码永不感知 Mock/Http 差异;**永不直连 ezPLM 数据库**。
- Tenant/User 表含可空字段 `ezplmTenantId`、`externalUserId`;鉴权层预留 JWT 验签适配器(将来 SSO)。
- 数据主权:ezPLM=物料主数据/库存/工程文件唯一真源(本系统只读+`ExternalPartSnapshot` 缓存);本系统=RFQ/报价/采购比价/OPO 流程唯一真源。禁止双写。
- 设计系统全部走 `app/globals.css` CSS 变量(品牌绿 `#00890b`=原生功能,紫 `#7B61FF`=AI 增强),即白标底座。

## 领域规则(来自三轮诊断的教训,单测必须覆盖)
- **报价状态机**:DRAFT→PENDING_APPROVAL→APPROVED/REJECTED/EXPIRED;分类未全部人工确认不得提交;提交存 submittedSnapshot、通过存 approvedSnapshot;PENDING/APPROVED 下参数全冻结;PDF/正式导出只用快照;退回记原因、改动走新 Revision,禁止覆盖已批准版本。
- **GTB**:`ceil(需求×(1+损耗率)) − 库存 − 在途`,结果不低于 MOQ 再按 SPQ 向上圆整;损耗率默认 0 且标注"待甲方确认"。
- **异常处理闭环**:采购填价时固化"原始异常集合"(wasFlagged);结论默认空、逐项人工选;REQUOTE/换货源/调价须新价重过校验,换货源必须记录新供应商/币种/MOQ/SPQ/LT/报价时间;PM 确认覆盖**全部原始异常行**(不按当前是否仍超线);流程状态用未处理数。
- **OPO**:行级 OPOLine 为唯一数据源,KPI/未回复表/差异表/异常清单全部派生,禁止手改 DOM 式的旁路计数;回复保存 replyEta/replyQty/replyNote/replyAt/replySource;催办 Cron 提前 4 天、CRON_SECRET、幂等键防重发;API 不可回写时生成 ERP Excel 模板(替代路径:Excel→中间表→RPA→API)。
- **排产**:DateTime 游标,两班 16h/天(08:00–24:00),下一工单开始=max(上一完成,齐料,工序就绪),禁止重叠;高级 APS 属二期,页面表述不得超出实现。
- **诚实 UI**:禁止"已发送/已生成/已联调"类虚假完成态;邮件=预览/模拟发送;集成状态只用 待确认/待授权/待联调/示例配置;比价页显示数据更新时间而非暗示实时。
- **角色**:PM / PROCUREMENT / ENGINEERING / MANAGEMENT / SUPPLIER;审批人必须存在于角色模型(无"销售主管/总经理/品质")。

## 数据访问约定(PR2 评审新增,2026-07-27)
- 自 PR3 起,所有业务查询/写入必须经 `lib/server/tenant-scope.ts` 的 `tenantWhere`/`tenantData`/`assertTenantScopedMutation` 守卫;Provider 与业务代码不得绕过直接拼 where。

## 外部字段解析纪律(PR4 评审新增,2026-07-27)
- 语义判定禁止裸 `includes`/`indexOf`:子串匹配会把否定式误判为肯定式(`Inactive` 含 `active`、`REACH Unaffected` 含 `affected`、`Not In Production` 含 `production`)。
- 一律走「规范化 → 精确映射表 → 词边界规则 → 否定式护栏」(见 `lib/providers/common/parse.ts`);含否定词而无法精确归类者返回 UNKNOWN/null,绝不落到"在产/合规/有货"。
- 每新增一处外部字段解析,必须在 `tests/unit/parse-negation.test.ts` 补一条否定式用例。

## 收尾汇报固定格式(PR4 评审新增,2026-07-27)
每个 PR 的结尾汇报必须包含:①`pnpm lint` / `typecheck` / `test`(含用例数与通过数)/ `build` 四项执行结果原文;②本 PR 修复的每个缺陷对应的回归测试名;③已完成/未完成清单;④Preview URL 或本地验证说明。

## PR 工作纪律
- 按 SPEC 第十九节 PR1–PR9 顺序;**一个会话只做一个 PR**;完成后停下,给出:测试结果、Preview URL(或本地验证说明)、已完成/未完成清单,等人类确认后才可进入下一个 PR。
- 每个 PR 必须通过:`pnpm lint && pnpm typecheck && pnpm test && pnpm build && prisma validate`(涉及 UI 流程的 PR 另跑 `pnpm test:e2e`)。
- 领域函数(GTB/价格阶梯/Markup/PPV/快照/Offer 排名/OPO 异常判定/tenant 隔离)必须有单测;关键流程必须有 Playwright 用例——**源码关键词式的自检不算验证**。
- 大 BOM(>50 唯一 MPN)必须走 ImportJob 分批(10–20/批)+ SSE/轮询进度,禁止单个同步请求处理整张 BOM。
- 汇报风格:如实区分"已实现/Mock 占位/待联调/超范围",宁可少报不可虚报。
