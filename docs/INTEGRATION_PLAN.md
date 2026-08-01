# ezPLM 系统升级整合方案
**输入材料**:① GPT《Next.js 全栈重构实施规范》(以下称"规范") ② 《AI+PLM 系统功能层级清单.xlsx》(客户测试后的功能现状表,32 项标"无"/新增) ③ 《AI_协同20260716-1.docx》(客户逐页测试意见) ④ 现有资产:静态原型 V5.2.1(18 页,三轮诊断加固)、NestJS 后端 V15(Prisma,42 表/41 枚举)

**结论先行**:规范可作为升级主干采纳,与我们前期沉淀的原则(诚实 UI、快照冻结、行级模型、确定性计算、人工确认闭环)高度一致。需要补的是:与 NestJS 资产的衔接方式、大陆部署可达性、三份材料间的范围冲突仲裁、以及 xlsx/docx 缺口到 PR 计划的映射。

---

## 一、四项前置架构决策(动手前必须定)

### 决策 1:后端归一到 Next.js,NestJS 转为 schema 与逻辑供体
规范要求 Next.js App Router 全栈(Route Handlers/Server Actions 即后端)。**采纳**,理由:
- 一个代码库、一次部署、一套类型,智能体(Vercel AI SDK)与 UI 同栈,交互开发效率最高;
- NestJS V15 的核心资产是 **Prisma schema(42 表)与业务规则**,而非框架本身。两边都是 Prisma,schema 平移成本低;service 里的 GTB/对账/校验逻辑翻译成 `lib/domain/` 纯函数即可复用;
- 避免双后端并行维护的分裂成本。

**行动**:PR1 阶段将 NestJS 的 `schema.prisma` 与规范第四节的模型清单做一次**合并对照表**(旧表→新表映射、新增表、废弃表),作为 PR2 的输入。NestJS 仓库打 tag 封存,只读参考。

### 决策 2:部署双轨 —— Vercel 开发/预览,客户生产走 Docker 到国内
规范未提但对本项目致命的一点:**乾创的用户在苏州,`*.vercel.app` 在大陆访问不稳定,Vercel 无大陆节点**。绑自定义域名可改善但不能根治。
- 规范 1.10 已要求"既可部署 Vercel,也可 Docker standalone" —— 正好承接"一套代码两种交付";
- **定案**:Vercel = 团队开发、PR Preview、给 GPT/内部演示;**客户 UAT 与生产 = 同一 Docker 镜像部署到国内主机(阿里云/腾讯云,或先 Railway 过渡)**;数据库按环境分离(Preview 用 Neon/Vercel Postgres,生产用国内 RDS PostgreSQL)。
- 域名与备案事宜提前启动(生产域名走 ezplm.cn 已备案体系最省事)。

### 决策 3:实时比价 = 官方 API,一期实现(客户诉求与规范一致)
docx 明确"实时询价抓取需放到一期"。规范用 **DigiKey Product Information V4 + Mouser API(禁止爬虫)** 实现,这是合法且客户诉求可满足的解法,**不冲突**。
- **前置事项(立即启动,有申请周期)**:DigiKey 开发者账号 + OAuth 应用(CLIENT_ID/SECRET)、Mouser API Key 的申请主体确定(建议乾创名义申请、硬禾代持配置),以及 ezPLM 内部 API 的文档与测试 Key 交付时间。没有这三样,PR3/PR4 只能停在 Mock —— 规范也明确"没有真实 Key 时用 Mock,不得伪造已联调",与我们的诚实 UI 纪律一致。

### 决策 4:范围冲突交商务仲裁,不默默吸进一期
详见第四节冲突清单。原则延续既有纪律:凡规范排除而客户文档要求的,进入"待商务确认"池,由你与乾创书面确认后再改基线。

---

## 二、现有资产迁移地图(什么能复用、怎么复用)

| 现有资产 | 去向 | 迁移方式 |
|---|---|---|
| 静态原型 18 页 HTML | `legacy-static/` | 仅作视觉参考(规范第二节);设计系统抽取到 `app/globals.css` + `components/ui`(绿 #00890b / 紫 #7B61FF 双色体系保留) |
| 报价状态机(DRAFT→…→APPROVED、submittedSnapshot/approvedSnapshot、修订版) | `lib/domain/quote/` | V5.2 逻辑直译为 TS 纯函数 + Prisma 事务;规范第十二节的快照/版本要求与现实现完全同构 |
| GTB 计算(需求×(1+损耗)−库存−OPO,≥MOQ,按 SPQ 圆整) | `lib/domain/gtb.ts` | 直译;损耗率仍标"待甲方确认" |
| OPO 行级模型(opoLines 派生 KPI/差异/异常/未回复) | Prisma `OPOLine/OPOReply` + 查询层 | 数据结构即规范第十四节要求;派生逻辑改为 SQL/服务端聚合 |
| 排产推进(DateTime 游标、两班 16h、无重叠) | `lib/domain/scheduling.ts` | 直译;仍标注"基础排序,高级 APS 二期" |
| 物料报价异常闭环(wasFlagged 原始异常集、采购处理→PM 确认→审批) | 采购 RFQ 模块(规范第十一节) | 状态字段与角色分离设计直接沿用 |
| jsdom 交互断言(审批后改折扣被拒、门户提交异常消失、排产无重叠等) | Vitest 单测 + Playwright E2E | 规范第十七节测试清单与我们已验证的场景几乎 1:1,把断言翻译成用例即可 |
| NestJS V15 Prisma schema(42 表) | 合并进新 schema | 见决策 1;规范新增的表(RFQ 族、AgentRun 族、ExternalPartSnapshot、SupplierOffer/PriceBreak、ProcurementRFQ 族等)为增量 |
| check-v*.py 的"校验必须抓真问题"经验 | CI 门禁 | `pnpm lint/typecheck/test/test:e2e/build + prisma validate` 每 PR 必跑(规范第十八节) |

**要点**:三轮诊断买来的教训已经物化在原型代码里,这次迁移是"翻译",不是"重做"。

---

## 三、xlsx/docx 需求 → 规范 PR 计划的映射

规范的 PR1–PR9 骨架保留,下表把两份客户文档的诉求逐类挂载进去("规范§"指 PDF 章节)。

### 3.1 已被规范覆盖(直接照做)
| 客户诉求(xlsx/docx) | 规范落点 | 挂载 PR |
|---|---|---|
| 所有子页面返回按钮、统一路由生成菜单 | §2/§16 | PR1 |
| 四个角色工作台、角色切换联动菜单/KPI/搜索范围 | §3/§16 | PR2 |
| RFQ 归入 PM"报价与客户"、附件/多 BOM/不报价关闭 | §5 | PR5 |
| BOM 批量多文件导入、导入历史台账、重复位号/EOL/封装校验、导入后直跳版本比对 | §6 | PR5 |
| 无 MPN 匹配顺序(客户料号→内部→MPN→…→人工) | §6 | PR5 |
| 候选显示呆滞数量/OPO/ETA/生命周期/数据更新时间 | §6+§10 | PR5/PR6 |
| ezPLM/DigiKey/Mouser 三源 + 线下 Excel 统一 NormalizedOffer 比价 | §7–§11 | PR3/PR4/PR6 |
| 采购 RFQ:PM 传 BOM→采购比价→选择理由→反馈 PM;现货/期货模式;换货源记录供应商/币种/MOQ/SPQ/LT | §11 | PR6 |
| 报价拆材料/人工/NRE/SMT/DIP/测试/管理费;行含 Markup/PPV/替代料;多人工费率模板 | §12 | PR7 |
| 报价快照冻结、退回出新 Revision、审批用快照出 PDF/XLSX | §12 | PR7 |
| OPO 行级模型、KPI 同源、提前四天催办 Cron、防重发、ERP Excel 模板兜底 | §14 | PR8 |
| KPI 风险色标、点击下钻、组合筛选、时间筛选、批量导出 | §16 | 分摊各功能 PR |
| AR/AP 按角色与 Tab 区分、对账发指定邮箱(邮件适配器预留) | §16+§5 InboundEmailAdapter 思路 | PR8 |
| 大 BOM(>50 MPN)ImportJob 分批 + SSE 进度 | §15 | PR5 |

### 3.2 客户要求但规范缺失 —— 建议吸入一期(增量补丁)
| 诉求 | 来源 | 建议落点 |
|---|---|---|
| **批量 update 报价**(批量导入 BOM,逐 BOM 生成 update 报价单) | xlsx 新增需求 | PR7 追加 `QuoteBatchUpdateJob`,复用 §15 批处理框架 |
| 报价统计(总表+转化率) | xlsx"无" | PR8 管理工作台报表卡 |
| PM 端采购申请单(GTB 核算 + 同 MPN 呆滞提示,从采购模块拆出) | xlsx | PR6 增 `/procurement/request` PM 视角页 |
| 供应商预设基础数据(MOQ/LT/多阶价格)维护页 | xlsx"无" | PR6(SupplierOffer/PriceBreak 已有模型,补维护 UI) |
| 批量发送订单 + 订单接受通知 + ETA 必须回 ERP | docx | PR8:批量发送用邮件适配器;"回 ERP"一期按 §14 的 ERP Excel 模板 + IntegrationJob,API 回写待客户 IT 确认(沿用既有替代路径原则) |
| **按上传 Excel 在 ERP 批量下单**("必要功能") | docx | PR8:一期交付"系统生成 ERP 可导入下单模板 + 导入回执登记";RPA/API 直写仍属二期,须向客户书面说明边界 |
| 供应商资料由供应商邮件直发建档 | docx | PR8 轻量实现:生成邀请链接/邮件模板,回填入 SupplierContact;自动解析邮件留给 InboundEmailAdapter 二期 |
| 损耗报告(筛选分析 + 按客户模板导出) | xlsx/docx"无" | 数据依赖工单投料,一期先做"损耗数据导入 + 模板导出"轻版挂 PR8;完整版待 MES 数据 → 商务确认 |
| 物料 DC 信息字段 + DC Aging 预警 | xlsx | PR5 Part 模型加 dateCode/msl/包装字段;管理工作台 DC Aging 卡挂 PR8 |
| 库存总览+呆滞移入管理层、按客户/日期条件 | docx | PR8 管理工作台 |

### 3.3 客户提出但规范明确排除 —— 进"待商务确认"池(不默默吸入)
| 诉求 | 冲突点 | 建议 |
|---|---|---|
| **ECN 完整流程**(发布/影响分析/批量物料/作废追溯/批量审批) | docx 大量 ECN 意见 vs 规范 1.11"不实现完整 ECN"、路由无 /ecn | 折中案:一期做 **ECN-Lite**(登记、单物料替换、审批、关联 BOM 版本),满足 xlsx"ECN 审核-有需改进";"发布/影响面/批量"列二期。需客户书面确认 |
| 品质模块(来料检验/客诉/品质报表/PPAP/RMA/制程 OCR) | docx 抱怨缺失 vs 规范排除 | 维持二期;向客户出示既有变更需求池条目,避免验收争议 |
| **DigiKey 价格口径(含税与否 / 是否受账户协议价影响)** | PR4 联调冒烟发现:DigiKey 返回 CNY 4.47586,Mouser 同料返回 USD 4.12,量级差异大,疑似口径不同 | **待确认,不臆断**:需向 DigiKey 确认 ①`X-DIGIKEY-Locale-Currency` 换算价是否含税 ②`X-DIGIKEY-Customer-Id`(DIGIKEY_ACCOUNT_ID)是否使账户协议价覆盖目录价 ③是否含关税/运费。确认前冒烟输出已加"价格口径"提示,比价页不得暗示两源同口径 |
| **跨币种比价是否引入汇率归一** | PR4 评审提出:客户实际比价多为 CNY 统一口径,但三方 API 可能返回 USD/EUR 报价 | 当前策略=**保留异币种报价但标注"不可比",不做换算**(诚实,不引入未经确认的汇率)。若需归一,需甲方确认:①汇率来源(银行中间价/ERP 内置/手工维护)②更新频率 ③报价快照是否留痕当时汇率(审批与 PDF 必须可复现)。**答复前维持现状,严禁硬编码汇率** |
| 生产报表 OCR + 稼动率 | xlsx"无" | 二期(依赖 MES/报表源);一期可给"生产报表文件上传归档"占位 |
| 客户自助查询(仅库存进出) | docx 问"不可以以权限进行?" | 可谈:若只读库存流水,技术上一期可加 SUPPLIER 同款轻门户;但属新增范围,**报价后再做** |
| PO 反查工单、**批次级**全链路 | xlsx"无"(需 MES) | **2026-07-31 范围变更(甲方确认)**:批次级追溯移入一期。边界:①**仅批次级**,SN 级仍属二期(无 SN 数据源);②数据靠**导入**(收料/工单用料/出货三张模板)+ ERP 同步,**无 MES 联动**;③隔离处置只在本系统登记并走人工审批,**不得显示 ERP/MES 已执行**;④Trace Agent 只出建议与证据,禁止自动冻结/通知/召回。PO 反查工单随批次图谱一并可达 |
| 高级 APS、SN 追溯、RPA run ERP | 双方一致为二期 | 维持 |

### 3.4 docx 页面级整改(BOM/ECN/物料页的卡片、筛选、下钻细节)
docx 对 erp.tindie.com 各页的意见(风险色标、组合筛选、历史台账、EOL 卡片、二级物料分类、MSL/盘装字段、同步日志导出等)不单列 PR —— **作为对应功能 PR 的验收清单附录**执行:PR5 附 BOM/导入/物料页整改项,PR7 附报价页整改项,PR8 附管理工作台整改项。规范 §16 已列大半,缺的按 3.2 表补。

---

## 四、实施顺序(在规范 PR1–PR9 上的微调)

```
PR1  Next.js 工程 + UI Shell + 路由/菜单统一配置
     └─ 追加任务:NestJS schema 合并对照表(决策1)
PR2  Auth/RBAC/Prisma/文件上传(合并后 schema 落库)
PR3  ezPLM Provider(Mock + Http 双实现,合同测试)
PR4  DigiKey/Mouser Provider ←【前置:三方 Key 申请,立即启动】
PR5  RFQ + BOM 导入匹配(含 3.2 的 DC 字段、docx BOM 页整改)
PR6  采购 RFQ 多源比价(含供应商预设、PM 采购申请单)
PR7  报价 Agent + 审批快照(含批量 update 报价、报价页整改)
PR8  OPO/管理工作台(含 ERP 下单模板、损耗轻版、DC Aging、报表)
PR9  Playwright 全量 E2E + 双轨部署(Vercel + Docker→国内)+ 文档
平行  ECN-Lite 与客户门户 → 待商务确认后插入 PR 队列
```

每个 PR 完成标准沿用规范第十九节:全测通过 + Preview URL + 已完成/未完成清单 + **不得声称 Mock 已联调** + 人工确认后进下一个。这与我们 check-v* 时代"校验必须抓真问题"的纪律一脉相承,建议再加一条:**每个 PR 附带其功能的 Playwright 用例,不允许只靠源码检查**(三轮诊断的核心教训)。

---

## 五、风险与前置事项清单(按紧急度)

1. **立即**:DigiKey/Mouser API 账号申请(有审批周期);确认申请主体与费用归属。**ezPLM API 文档+测试 Key 调整为"不阻塞开发、只阻塞最终联调"**——开发全程走 MockEzplmProvider(规范§7),待 ezPLM 团队有空时再接 HttpProvider 做合同测试,不催不等(详见第七节)。
2. **立即**:与乾创书面确认 3.3 冲突清单(尤其 ECN-Lite 方案与 ERP 下单"模板兜底"边界),避免 UAT 时再爆范围争议。
3. **PR1 前**:生产部署目标定案(国内主机选型、域名/备案、生产 PostgreSQL);Vercel 区域按规范选 sin1(新加坡,大陆访问相对最好)。
4. **持续**:Vercel Serverless 时长限制 → 大 BOM/批量报价严格走 ImportJob 分批(规范 §15),禁止同步长请求;Cron 用 CRON_SECRET + 幂等键(规范 §14 已列)。
5. **数据风险**:Mouser 限流(50 条/次+日配额)与 DigiKey 429 → 缓存 TTL 按 §15 执行,比价页要显示"数据更新时间"而非暗示实时(诚实 UI)。
6. **交付叙事**:给客户的说法建议为"原型确认版(静态)→ 交互系统 α(本次)",xlsx 里"有,但需改进"的项在 α 版逐项对号销项,用 3.1/3.2 表作为双方的销项清单。

---

## 六、给你的三个建议动作

1. 把本文档 3.3 表转成一页《范围确认函》发乾创签认(延续 phase2 池纪律);
2. 启动 DigiKey/Mouser API 申请 —— 这是当前唯一的外部硬阻塞(ezPLM API 已按第七节策略降级,不在关键路径上);
3. PR1 开工时,先让实现方(Claude Code / 团队)产出"NestJS 42 表 ↔ 规范模型清单"的合并对照表提交评审,再动 Prisma —— schema 是这次升级里最不能返工的东西。

---

## 七、与 ezPLM 本体的融合策略

**背景**:ezPLM(www.ezplm.cn,私有化部署)本体已覆盖项目/任务/物料/库存/订单/生产/供应商等域,现有租户数据即是资产(物料 2000+、工程文件 200+)。新系统的三个既定事实——客户需要自有域名、将来作为独立产品外销、ezPLM 团队当前无暇配合——共同指向的形态是:**独立部署、多租户、经 API 消费 ezPLM 数据的系统**。因此"先独立 + API 取数"不是融合困难时的退路,而是主路线本身;融合按下述分层推进,ezPLM 团队的投入被压缩到最后"拧两颗螺丝"。

### 7.1 融合的三个层次(只放弃最贵的一层)

| 层次 | 内容 | 成本 | 决策 |
|---|---|---|---|
| **L1 数据融合** | 新系统经 `EzplmPartsProvider` 读取 ezPLM 的物料主数据/库存/在途/客户料号映射/替代关系/合规 | 低(规范§7 已设计,Mock/Http 双实现) | **一期实施**,开发期走 Mock,零依赖 ezPLM 团队 |
| **L2 体验融合** | 同域名子路径挂载(反向代理 `/scm`)+ 单点登录(SSO)+ ezPLM 侧边栏加一个菜单入口;用户感知为"一个产品" | 中低(反代 + token 验签;ezPLM 侧仅需加菜单项 + 签发 token 接口) | **预留钩子,择期实施**;私有化场景两套 Docker 同机并排跑 |
| **L3 代码融合** | 合并代码库、共享发布 | 高(摸清对方技术栈、发布互相牵制、锁死独立销售叙事) | **永久搁置**,除非将来出现压倒性理由;L2 做到位后用户已无感差异 |

### 7.2 现在就要埋的五颗"融合钉子"(框架期低成本,事后补极痛)

1. **Provider 纪律绝对不破**:所有 ezPLM 数据只经 `EzplmPartsProvider` 进出;业务代码不感知 Mock/Http 差异;**永不直连 ezPLM 数据库**。这是独立与融合两条路共同的前提。
2. **认证可插拔**:一期用本地账号体系,但鉴权层预留 token 校验适配器(OIDC/JWT 验签):将来 ezPLM 签发 token 跳转、新系统验签即登录,即 L2 的 SSO。`Tenant`/`User` 表**现在就加**可空字段 `ezplmTenantId`、`externalUserId`,免去将来数据迁移(ezPLM 的租户+角色结构与规范 Tenant/Role 模型可对应)。
3. **部署路径可配置**:`basePath` 可配(如 `/scm`)、静态资源相对引用、不写死绝对 URL —— Next.js 原生支持,成本≈0;这是挂到 ezPLM 域名子路径反代的前提。
4. **数据主权单一真源,禁止双写**:**ezPLM = 物料主数据/库存/工程文件的唯一真源;新系统 = RFQ/报价/采购比价/OPO 协同流程的唯一真源**。新系统对物料库存只读(API + `ExternalPartSnapshot` 缓存快照,规范已有此表);流程结果需回写时走明确回写接口或导出文件,绝不在两侧各存一份可编辑物料库。
5. **设计系统 token 化**:颜色/圆角/字体收敛为 `globals.css` CSS 变量(规范已要求)。将来贴合 ezPLM 视觉=换一套 token;外销给其他客户=同一机制即白标能力,一举两得。

### 7.3 对 ezPLM 团队的最小打扰清单(待其有空时一次给齐)

| # | 事项 | 归属层 | 预估工作量 |
|---|---|---|---|
| 1 | PartsProvider 所需只读 API:searchParts / getPartByMpn / batchResolve / getInventory / getCustomerMappings / getAlternates / getCompliance(规范§7 接口签名即需求文档) | L1 | 若 ezPLM 已有内部 API,主要是开权限+出文档 |
| 2 | 测试环境 Base URL + API Key | L1 | 配置级 |
| 3 | SSO token 签发接口(约定 JWT claims:tenantId/userId/role/exp) | L2 | 小 |
| 4 | ezPLM 侧边栏新增"AI 供应链协同"菜单项(跳转 /scm) | L2 | 极小 |
| 5 | (可选)流程结果回写接口(报价结果/采购建议),无则走导出文件 | L2+ | 视意愿 |

> 建议将本表单独抽成一页《ezPLM 对接接口需求清单》,ezPLM 团队忙时看一页即可;第 1/2 项到位即可完成 L1 联调,3/4 项到位即可完成 L2。

### 7.4 与整体计划的衔接

- 对第五节风险项 1 的修订已生效:ezPLM API **不阻塞开发,只阻塞最终联调**;PR3(ezPLM Provider)按规范以 Mock 完成全部业务开发与合同测试骨架,Http 实现留待接口就绪后补一次联调 PR。
- 独立产品外销与"一套代码两种交付"的关系:Vercel(演示/预览)+ Docker(客户私有化/国内主机)双轨不变;白标与多租户能力(7.2 第 5 条 + 规范 tenant 约束)即外销的技术底座。
- 客户域名:独立部署天然支持;若客户同时是 ezPLM 私有化用户,则按 L2 同域反代方案二选一或并存(独立域名 + ezPLM 菜单内嵌均可达)。

---

## 八、Backlog(已实现底座、待补界面/配置的项)

> 与"待商务确认池"(3.3)不同:本表各项**范围已确认、数据层已就绪**,只差界面或配置维护,
> 属工程排期问题而非范围问题。每项注明已有什么、缺什么、建议补在哪个 PR。

| # | 项 | 已有 | 缺 | 建议补入 | 记入日期 |
|---|---|---|---|---|---|
| B1 | ~~PM 采购申请单页 `/procurement/request`~~ | — | — | ✅ **已完成 2026-07-28**:GTB 试算(展示逐步计算过程)+ 同 MPN 呆滞提示 + 提交落 `gtbSnapshot` | 2026-07-27 |
| B2 | ~~供应商预设基础数据维护页~~ | — | — | ✅ **已完成 2026-07-28**:`/procurement/suppliers` 可维护 MOQ/SPQ/LT/多阶价格并列表展示 | 2026-07-27 |
| B3 | ~~采购异常阈值维护~~ | — | — | ✅ **已完成 2026-07-28**:新增 `ProcurementPolicy` 表按租户持久化;比价页改用该策略;**口径未勾选「已业务确认」时 UI 持续标注「非正式风控」**,阈值口径本身仍待业务确认 | 2026-07-27 |
| B4 | ~~多源询价单次上限 20 个料号~~ | — | — | ✅ **已完成 2026-07-28**:改为拉取式分批(offset/batchSize + progress),UI 显示询价进度,不再静默截断 | 2026-07-27 |
| B5 | ~~线下报价导入仅取 MPN + 单价列~~ | — | — | ✅ **已完成 2026-07-28**:抽出通用列映射引擎;新增供应商报价字段集(MPN/单价/币种/MOQ/SPQ/LT/描述),单价无法解析的行跳过并回报原因,绝不按 0 落库 | 2026-07-27 |
| B6 | 报价 PDF 导出 | ✅ **打印视图已完成 2026-07-28**:`/quotes/[id]/print` 只读冻结快照,浏览器「打印 → 另存为 PDF」可产出 PDF;无快照即拒绝渲染 | **服务端直接生成 PDF** 仍未做:需嵌入中文字体(体积/授权)或引入无头浏览器;邮件附件、批量导出等场景需要它 | 有批量/邮件需求时 | 2026-07-28 |
| B7 | 批量 update 报价(`QuoteBatchUpdateJob`,整合方案 3.2) | §15 批处理框架已在 BOM 导入验证 | 作业模型与页面 | PR8 后评估 | 2026-07-28 |

## 九、计划偏差记录

| 日期 | 偏差 | 决策 | 影响 |
|---|---|---|---|
| 2026-07-28 | **新增 SPEC §4 之外的模型 `ProcurementPolicy`** | 异常判定阈值原为页面内常量,无法作为正式风控;按租户持久化后才可维护与审计 | schema 从 43 模型增至 44;`confirmedByBusiness` 未勾选时 UI 强制标注「非正式风控」,阈值口径本身仍待业务确认 |
| 2026-07-27 | **DigiKey / Mouser 真实联调完成**:由用户在本机执行 `pnpm smoke:external` 验证(真实凭据存 .env.local,未进版本库),回报真实调用成功、阶梯价正确、候选无价格、限流与 token 缓存生效、apiKey 脱敏与安全自检通过 | DigiKey/Mouser 状态由"待联调验证"更新为**已联调**;ezPLM 维持待联调 | 联调由用户执行并回报,实现方未直接持有凭据、未观察原始输出;若后续真实响应结构变化,以 Zod validation 结构化错误为准修正契约 |
| 2026-07-27 | **ExternalPartSnapshot 持久化延至 PR6**:PR4 只交付内存缓存实现与缓存键/TTL 策略(SPEC §15) | 缓存的 Prisma 落库(经 tenant 守卫写 ExternalPartSnapshot)在 PR6 消费侧接入 | PR4 的"缓存"能力仅进程内有效,多实例部署不共享;验收时不得按"缓存已持久化"计 |
| 2026-07-27 | **DigiKey/Mouser API 凭据到位**:申请完成并经人工测试可用(第五节风险项 1 与决策 3 的前置事项解除) | PR4 外部依赖解除,可做真实联调;真实 Key 仅存 .env.local(不进版本库/不进对话),代码经环境变量读取,日志与错误信息禁止输出 Key 明文 | 当前唯一阻塞项仅剩 GitHub 账号申诉(push/Preview);ezPLM API 维持"不阻塞开发、只阻塞最终联调" |
| 2026-07-27 | **Prisma 版本固定 7.9.0**:7.9.1 的引擎依赖(@prisma/fetch-engine)npmmirror 未同步,国内镜像无法安装 | 固定 prisma / @prisma/client / @prisma/adapter-pg = 7.9.0;镜像同步后评估升级 | 客户生产走国内主机,镜像可安装性为硬需求;升级前需复测 migrate/generate |
| 2026-07-27 | **GitHub 账号 eehubio suspended**:push 与 Vercel Preview 阻塞 | 阻塞期间每个 PR 完成时 `git bundle create --all` 备份到仓库外;push 恢复后先 `git fetch` 核对远端再推 | 本地 feature/nextjs-agent-v1 为唯一副本;Preview URL 暂无法提供,以本地验证代替 |
| 2026-07-27 | **SPEC 级缺口备案(评审备案 F)**:SPEC §4 的 43 模型不含工单/齐料需求数据,但 §2 路由含 /shortage、/kitting | PR8 前需决策:新增只读缓存表(如 WorkOrderDemandSnapshot)还是经 Provider 实时取;数据主权归 ezPLM/ERP 侧不变;现阶段不加表 | /shortage、/kitting 页面在数据来源决策前只能做占位/导入形态;GTB 的"需求"输入暂以导入或人工录入为准 |
| 2026-07-27 | **旧 NestJS V15 schema.prisma 不可得**:`reference/nestjs-v15/` 始终为空,经人工确认旧后端文件永久缺失(评审方 2026-07-27 确认) | 决策 1 中"NestJS schema 合并对照"路径作废;**SPEC §4 的 43 模型为唯一 schema 基线**;`docs/SCHEMAMERGEMAP.md` 由合并对照表改为 BASELINE 落库核对表 | PR1 交付项第 6 项(合并对照表)范围变更为"SPEC §4 落库核对表";第二节迁移地图中"NestJS V15 Prisma schema(42 表)→ 合并进新 schema"一行失效;NestJS service 业务规则仍按原计划以 CLAUDE.md 领域规则 + 静态原型逻辑为准直译,不再参考旧代码 |
