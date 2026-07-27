# KICKOFF PROMPTS — 各 PR 开工指令(逐个粘贴使用)

> 用法:每个会话只粘贴一个 PR 的指令。PR 完成、经你(必要时连同 GPT/Claude 评审)确认后,再开下一个。

---

## 【PR1 开工指令】工程骨架 + UI Shell + schema 对照表

请先完整阅读 CLAUDE.md、docs/SPEC.pdf、docs/INTEGRATION_PLAN.md,然后执行 PR1:

1. 将 docs/SPEC.pdf 转写为 docs/SPEC.md(保留全部章节与约束原文,便于后续引用);
2. 确认现有 HTML 均已位于 legacy-static/(仅参考,禁止修改);
3. 按 SPEC 第二节建立 Next.js 工程:package.json、tsconfig、next.config.ts(含可配置 basePath)、eslint、测试配置(Vitest + Playwright 脚手架);
4. 从 legacy-static/customer-confirmation 的设计中抽取设计系统到 app/globals.css(CSS 变量,含 --brand:#00890b 与 --ai:#7B61FF)与 components/ui、components/shell;
5. 按 SPEC 第二节路由清单建立基础路由与统一 route config 生成的左侧菜单;所有子页面有返回上一层按钮;
6. 产出 docs/SCHEMA_MERGE_MAP.md:reference/nestjs-v15/schema.prisma 的 42 表 与 SPEC 第四节模型清单 的合并对照表(旧表→新表映射 / 新增表 / 废弃表 / 字段级差异要点),本 PR 只出对照表,不落库;
7. 跑通 pnpm lint && pnpm typecheck && pnpm build;
8. 提交 PR(feature 分支),输出:已完成/未完成清单、测试结果、对照表要点摘要,然后停下等我确认。禁止进入 PR2。

---

## 【PR2 开工指令】Auth/RBAC/Prisma/文件上传

前提:PR1 已确认,docs/SCHEMA_MERGE_MAP.md 评审意见(如有)如下:〔粘贴评审意见或写"无修改"〕。

执行 PR2:按评审后的对照表落地 prisma/schema.prisma(全表带 tenantId;Tenant/User 含可空 ezplmTenantId/externalUserId);实现 SPEC 第三节五角色 RBAC 与四个工作台骨架(角色切换联动菜单/KPI/搜索范围);本地账号认证 + 预留 JWT 验签适配器;FileStorageProvider(VercelBlob + Local 双实现);AuditLog 写入通道。完成 SPEC §18 全部检查项后停下等确认。

---

## 【PR3 开工指令】ezPLM Provider

执行 PR3:按 SPEC 第七节实现 EzplmPartsProvider 接口 + MockEzplmProvider(用 legacy-static 中的示例物料构造逼真 mock 数据)+ HttpEzplmProvider 骨架(Zod 校验/超时/重试/熔断/合同测试)。环境变量 EZPLM_API_BASE_URL/EZPLM_API_KEY 仅服务端。真实 API 未就绪属预期,所有页面凡展示 mock 数据处须可辨识为演示数据,汇报中明确标注"Http 实现待联调"。完成后停下等确认。

---

## 【PR4 开工指令】DigiKey/Mouser Provider

前提:Key 状态——DigiKey:〔已到位/未到位〕,Mouser:〔已到位/未到位〕。

执行 PR4:按 SPEC 第八/九节实现 DigiKeyAuthService/TokenStore/Provider(OAuth 缓存刷新、429 退避、X-RateLimit 记录、KeywordSearch 仅作候选)与 MouserProvider/RateLimiter(50 条/次、分钟限流、日配额);统一输出 NormalizedOffer(SPEC 第十节),实现并单测确定性函数:getApplicablePriceBreak / calculateRoundedPurchaseQty / calculateExtendedPrice / compareOffers / rankOffers(排名综合库存/MOQ/SPQ/总额/LT/生命周期/供应商优先级,不只看最低单价)。Key 未到位的通道用 Mock 并如实标注。完成后停下等确认。

---

## 【PR5 开工指令】RFQ + BOM 导入匹配

执行 PR5:按 SPEC 第五/六节实现 RFQ 全状态机与附件管理、BOM 多文件导入(CSV/XLSX/图片/PDF)、列映射、重复位号/EOL/封装校验、导入历史台账、导入后直跳版本比对;八级匹配顺序与候选信息展示(含呆滞/OPO/ETA/数据更新时间);>50 唯一 MPN 走 ImportJob 分批 + 进度。并落实 docs/INTEGRATION_PLAN.md §3.2 中挂 PR5 的项(Part 增 dateCode/MSL/包装字段)与 §3.4 BOM 相关页面整改。Playwright:RFQ 创建上传、关闭不报价、BOM 导入匹配人工确认。完成后停下等确认。

---

## 【PR6 开工指令】采购 RFQ 多源比价

执行 PR6:按 SPEC 第十一节实现采购 RFQ(接收 PM BOM、线下 Excel 导入、ezPLM/DigiKey/Mouser 三源查询、NormalizedOffer 汇总、最低价与推荐标识、采购选择/修改/拒绝+理由、反馈 PM、现货/期货、换货源全要素记录);并落实 INTEGRATION_PLAN §3.2:供应商预设基础数据维护页、PM 采购申请单(/procurement/request,GTB+同 MPN 呆滞提示)。Playwright:同一 MPN 四源比价、采购选择反馈 PM。完成后停下等确认。

---

## 【PR7 开工指令】报价 Agent + 审批快照

执行 PR7:按 SPEC 第十二节实现报价(材料/人工/NRE/SMT/DIP/测试/管理费/其它分块;行含 Markup/PPV/替代料;多人工费率模板)、快照冻结与 Revision(严格按 CLAUDE.md 领域规则:提交/批准双快照、冻结、退回新版);QuoteAgent(建议须确认);并落实 §3.2 批量 update 报价(QuoteBatchUpdateJob 复用批处理框架)与报价页整改。单测:Markup/PPV/快照;Playwright:计算-审批-退回-新版-批准全链。完成后停下等确认。

---

## 【PR8 开工指令】OPO + 管理工作台

执行 PR8:按 SPEC 第十四节实现行级 OPOLine 模型(KPI/未回复/差异/异常全派生)、供应商回复五字段、每日 Cron 提前 4 天催办(CRON_SECRET+幂等键+失败进 IntegrationJob)、ERP Excel 模板兜底;并落实 §3.2 挂 PR8 项:ERP 批量下单模板+回执登记、批量发送订单与接受通知(邮件适配器)、供应商邀请建档、损耗报告轻版、DC Aging、库存总览/呆滞移入管理工作台、报价统计卡。Playwright:OPO 回复-提醒-导出。完成后停下等确认。

---

## 【PR9 开工指令】E2E 全量 + 双轨部署

执行 PR9:补齐 SPEC 第十七节全部 Playwright 用例(含角色切换权限、API 降级提示、AuditLog 断言);CI 按 §18;产出 Dockerfile + docker-compose.local.yml + .env.example,验证 standalone 镜像可起(生产走国内部署,见 INTEGRATION_PLAN 决策 2);Vercel Preview/Production 环境变量分离,sin1 区域。输出部署文档与"已实现/Mock 待联调/超范围"三色清单,停下等最终验收。
