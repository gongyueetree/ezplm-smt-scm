# R4 v2 IMPLEMENTATION REPORT
# Material Intelligence, Manufacturer Resolution & Procurement Cost Loop

> 生成:2026-09-16 · 依据任务书《R4 v2》与真实乾创 7 文件 UAT 数据
> 本报告只含聚合统计与设计事实,不含任何真实客户/供应商/物料具体值。

## 1. Executive Summary

基于乾创电子真实金蝶导出数据(7 文件,含 52,256 行「物料 MFG 维护单」),完成从
Demo/仿真阶段到正式业务架构的升级:三层身份体系(Internal PN ≠ Manufacturer/MPN ≠
Customer PN)正式落库;乾创字段解析全部收入主仓 ERP Integration Agent(Kingdee Excel
Adapter → Canonical DTO → 业务层),ERP Lab 回归纯合约模拟器;Manufacturer Resolution
六级确定性解析(ezPLM 为标准厂商真源);16K/52K 规模的静默截断全部定向查询化;
供应商策略、统一价格池、多供应商 RFQ、成本矩阵、报价成本快照、ERP PO 三日期分离与
历史采购价闭环全部落地,并以真实数据端到端实测。

## 2. Repository SHA(实施起点)

- ezplm-smt-scm main:`b30268ca01f4a2ec5fc3cf2540fb154eb97b7592`
- ezplm-erp-lab main:`5de2f71f0fd0426bab9c52de5f45741e99a86e4a`

## 3. Real Dataset Audit(摘要;全文 R4_REAL_DATA_AUDIT.md)

| 文件 | 行数 | 关键实测 |
|---|---|---|
| 物料 | 16,209 | **无任何 MPN/MFG 列**;`料号类型` 列 = MaterialKind 一级证据(阻容感 7259/IC 3189/结构件 2737/PCB 1285/PCBA 1202…) |
| 物料 MFG 维护单 | **52,256** | 一料多厂 **7,567**、一厂多料 **14,843**(N:M 实锤);通配 MFG_PN 292;原始厂商 2,959 种写法、313 组变体、垃圾值 1,152 行 |
| 即时库存 | 4,455 | 货主类型 客户 2,978 / 业务组织 1,477;仅「库存量」一个数量列 |
| EXCESS | 1,569 | 最后业务发生时间 891 有值/678 空白;「溢发」列 100% 空 |
| 供应商 / 客户 | 629 / 201 | PO 供应商名 82/82、库存客户货主 20/20 与主数据**零匹配**(脱敏不一致) |
| 采购订单 | 638 行 | 双「备注」列;MFG_PN 空 180 行(合法);物料命中主数据仅 144/638(导出口径) |

跨文件缺口经形态诊断证实**非键格式问题**而是导出口径 —— 一律 UNRESOLVED 如实计数,不补造。

## 4. Cross-file Reconciliation / UAT Package(R4-4)

7 角色齐备校验 → 全量 Validation 先行 → STRICT_UAT(任何 INVALID_* 整包拒绝;
UNRESOLVED_REFERENCE 计数不拒包)→ 单事务原子提交 → `datasetVersion`
(QCUAT-业务日期-内容哈希,含 alias override 哈希,可复现)→ 同包重放幂等拒绝(实测)。
真实全包提交(scratch 库):客户 201 / 供应商 629 / Part 16,209 / CUSTOMER_PN_UNSCOPED
16,191 / PartMfgMapping 21,691(+499 去重;30,066 孤儿跳过计数)/ 库存 4,455
(availableQty 全 null,组织行 customerId 全空)/ Excess 1,569 / ERP PO 18 单 165 行
(3 个测试 override;168 单待正式对照表)。

## 5–6. Material Identity / PartMfgMapping(R4-2)

- `Part.materialKind` 7 值(§7)+ 分类来源/置信度;`Part.mpn` 降级为 preferred 缓存
- `PartMfgMapping` N:M 真源(§8):raw 串永久保留、identifierKind(§9)、
  identifierMatchMode(§10:`*`→PATTERN 禁 exact/自动确认)、relationType 与 status
  分离(§21:MAINTAINED ≠ Approved AVL,默认保守由租户配置)
- Legacy backfill:1,413 条既有 Part.mpn → LEGACY_BACKFILL/PRIMARY/APPROVED(实证 1413→1413)
- 守卫(§22/§23):PO_HISTORY 恒 CANDIDATE/HISTORICAL 封顶 0.75,永不自动覆盖 Part.mpn;
  preferred 同步仅 APPROVED+PRIMARY+人工确认+非 PATTERN

## 7. Manufacturer Resolution(R4-3)

- `CanonicalManufacturerRef`(ezPLM 真源;CURATED 引导 22 家)+ `ManufacturerAlias`
  (GLOBAL 13 条种子 / TENANT,互不污染)
- 六级解析(§16):租户别名→全局别名→标准名精确→**MPN 证据(0.98 候选,§20 不落
  永久别名)**→相似候选(≤0.70)→UNRESOLVED;§17 MPN 帮助校验厂商;§18 冲突
  MANUFACTURER_CONFLICT 人工裁决不覆盖;#N/NA/0 零误建
- 键规则统一为含 CJK 的字母数字保留(TS 与 PG 双端实测一致;修复了纯 ASCII 把
  「风华高科」剥成空串的缺陷)
- Review UI:/materials/manufacturer-review(建议/证据/批准落租户别名/批量仅确定性来源)
- **真实覆盖实测**:2,959 个 unique 原始厂商串,22 个引导标准名即确定性覆盖 40.9%
  映射行;长尾如实 UNRESOLVED 待评审

## 8–10. Inventory / Excess / PO Import 语义

- 库存(§33):ownerType CUSTOMER/ORGANIZATION/UNKNOWN;业务组织 customerId 恒空;
  available/reserved **null=未知**(绝不 =onHand/0);孤儿行保留(partId 空 + 原始编码)
- Excess(§34):最后业务发生时间→lastBusinessAt,earliestInboundAt=null;
  blank→null,非空非法→INVALID_DECIMAL(真实包实测零非法值)
- PO(§49/§50):`erpPoNumber`=正式业务身份(租户内唯一);行级三日期分离
  requestedDelivery ≠ supplierEta ≠ receipt;稳定 sourceLineNo(不用 materialCode 当行键);
  双备注保留;PO→MFG 证据 PO_HISTORY

## 11–15. Supplier Strategy / Price Pool / RFQ / Price Break / Cost Matrix

- 策略(§30/§31):复用 PartSupplierRef 扩展,两级作用域(Internal PN 与 +MFG 件,
  件级覆盖);Excel 导出/导入 Preview→Confirm→Audit,invalid 即整包拒
- 推荐(§40):Blocked 沉底零分;Approved/Preferred/精确支持/价格/LT/历史逐项计分出
  人话 reasons;Preferred 不自动胜出(单测);推荐≠决定
- 价格池(§39):NormalizedMaterialPrice 统一 DTO(来源/时间/币种/适用数量/有效期/
  证据/审批态);排除矩阵逐条给原因(§26v2);Supplier-only 与 Overall 双口径;
  freshness 分来源口径;PRICE_QTY_BASIS(§44)+复用既有 MOQ/SPQ 圆整与选档
- 多供应商 RFQ(§41/§42/§43):每家不同行清单;线下 Excel 导出/回传闭环
  (多档阶梯全落,绝不只留最低价);Quoted Manufacturer 走同一 Resolver,冲突打标;
  报价审批 RECEIVED→APPROVED/REJECTED/EXPIRED(§37),池内消费真实审批态
- 成本矩阵(§45):每行 Internal/Historical/Distributor/Supplier Low-High/Overall/
  Selected + 展开候选;成本选择只能选池内真实候选(防幻价),未审批引用强制
  UNAPPROVED_SOURCE

## 16. Quote Cost Snapshot + Completeness Gate(R4-8)

提交审批冻结 `costEvidence`(coverage/逐行候选与选中/qtyBasis/原币种)进
submittedSnapshot —— Live API 刷新不改已批报价;缺成本行拦提交(missing_cost,
兼容旧采购比价链路,报价全链 e2e 10/10 实证);FX:候选保留原币种原价,跨币种不
混比(O3 未答不做自动换算)。

## 17–18. ERP PO / Delivery / Receipt / Historical Price(R4-9)

见 §8-10;历史价:PO.unitPrice=实际成交,与 SupplierOffer 分表互不覆盖;
price-pool HISTORICAL_PO 真实接入 + Last/Lowest/Highest 查询(料/供应商/MPN/日期窗;
多币种如实注明);真实链路实测 PASS(ERP 单号保留/三日期分离/池内候选带 PO 证据)。

## 19. Scale Fixes(§32)

三处 `take:5000` 静默截断全部定向化(bom-import 匹配上下文 / erp-sync 物料差异 /
alternate-search localHit);MPN 通道走 PartMfgMapping 归一键索引;相似度语料上限 2 万
且截断**显式 degraded 上报**。真实 16K/21K 库实测:第 6,000/16,000 号料命中,
52K 映射尾部 MPN 解析出 2 个内部料;内存 20K 料/50K 映射矩阵单测(#19999 命中)。

## 20–21. Golden / Private UAT

- 私有 UAT(`pnpm test:uat:qianchuang`,QIANCHUANG_UAT_FIXTURE_DIR 未配置必 FAIL):
  11/11 —— §41 结构断言全清单(N:M/无MPN/多义/双货主/未解析引用全部 >0 如实存在)+
  datasetVersion 复现 + 真实 7 文件全量适配器冒烟 + 厂商解析覆盖实测
- 单测/金样:1,656 单测 + 39 金样(含 R3-8 安全矩阵);内存规模 golden(20K/50K)
- 原始 Excel 与私有产物全部 gitignore(实测 git 零跟踪);日志/审计零真实数据行

## 22. Security

审计载荷红线守卫(凭据键深度扫描抛错)沿用 R3-8;UAT 导入审计只记聚合计数;
alias override 私有不入库;门户/租户隔离金样与 E2E 全绿沿用。

## 23. Test Results(最终门禁,各 PR 均过)

lint 0/0 · typecheck 0 · prisma validate ✓ · 单测 **1,656/1,656** · 金样 39 过 1 跳 ·
build ✓ · 私有 UAT **11/11**(真实数据)· 闭环验收 **8/8**(真实 Lab v2.5.0,合约 16 操作)·
报价全链 e2e 10/10 · f7 BOM e2e 3/3;每个 PR 的 CI quality-gates 绿后合并。

## 24. Remaining Customer Questions(BLOCKED,不猜)

1. **供应商/客户名称对照表**(脱敏不一致):82 个 PO 供应商名 + 20 个库存客户货主名
   → `uat-reference-overrides.json`(私有);到位前相应 PO/货主解析 BLOCKED_DATA
2. **金蝶正式 API 文档(O1)**:Adapter 骨架已就位,WAITING_FOR_DOCUMENTATION
3. **「MFG 维护单 = 正式 AVL?」**:默认保守(MAINTAINED/CANDIDATE);确认后开
   租户配置 erpMfgMaintenanceAsApproved
4. **汇率口径(O3)**:跨币种比价/历史价归一暂不做,如实注明
5. **物料主数据导出口径**:库存/PO/维护单引用了 16,209 之外的大量编码(孤儿如实计数);
   建议提供全量物料导出
6. Excess 样表 O2 / AR-AP N6 等沿袭 Round3 待办

## 25. PR Links

主仓:R4-0 #75 · R4-1 #76 · R4-2 #77 · R4-3 #78 · R4-4 #79 · R4-5 #80 · R4-6 #81 ·
R4-7 #82 · R4-8 #83 · R4-9 #84 · R4-10/11 #85 · 报告 #86
Lab:R4-10 ezplm-erp-lab#5

## 26. Acceptance Matrix(§59,真实结果)

| Capability | Status |
|---|---|
| 7-file Private UAT | **PASS**(真实全包原子导入 + 11/11 断言) |
| Kingdee Excel Adapter | **PASS** |
| Canonical ERP Layer | **PASS** |
| ERP Lab Decoupling | **PASS**(乾创解析零下放;Lab 纯合约) |
| Material without MPN | **PASS** |
| MaterialKind / PCB Classification | **PASS**(料号类型一级证据;PCBA≠PCB) |
| PartMfgMapping | **PASS** |
| Internal PN → Multiple MFG Part | **PASS**(实测 7,567) |
| MFG Part → Multiple Internal PN | **PASS**(实测 14,843) |
| Canonical Manufacturer Master | **PASS**(ezPLM 真源;CURATED 引导) |
| Global / Tenant Manufacturer Alias | **PASS**(互不污染,单测锁定) |
| MPN Evidence Resolution | **PASS**(0.98 候选,不落永久别名) |
| Manufacturer Conflict Detection | **PASS**(不覆盖任何一方) |
| Manufacturer Review UI | **PASS** |
| Raw Manufacturer Evidence | **PASS**(raw 永久保留) |
| PCB skips Component Providers | **PASS**(零调用实证) |
| Customer PN Ambiguity | **PASS**(6,575 一对多;UNSCOPED 不进 mapping) |
| Inventory Owner Semantics | **PASS**(组织≠客户;available 未知) |
| Excess Semantics | **PASS**(lastBusinessAt≠earliestInbound) |
| PO → MFG Evidence | **PASS**(全部命中维护单,evidenceCount 累积) |
| PO/MFG Maintenance Reconciliation | **PARTIAL**(证据去重与状态保护已落;§48 六态交叉检查面板未做) |
| Pre-BOM Analysis | **PARTIAL**(匹配 v3/routing/mfgParts/成本矩阵 API 全通;§38 专属分析页 UI 未做) |
| ezPLM + Qianchuang Dual Matching | **PASS**(§27 顺序;双源汇合于 canonical Mfr+MPN) |
| Supplier Strategy(两级) | **PASS**(Excel 批量维护闭环) |
| Price Pool | **PASS** |
| Historical Purchase Price | **PASS**(真实链路实测) |
| DigiKey / Mouser | **PARTIAL**(既有 provider 与匹配/比价链在;价格池聚合位就绪,矩阵 Distributor 列接实时抓取待接线) |
| Multi-Supplier RFQ / Supplier-specific Lines | **PASS** |
| Offline RFQ Excel | **PASS**(导出↔回传往返) |
| Supplier Quote Import | **PASS**(多档阶梯全落) |
| Price Break / BOM Low-High | **PASS**(§44 basis + §26v2 排除矩阵) |
| Quote Cost Snapshot | **PASS**(冻结实证;e2e 回归) |
| Customer Quote Generation | **PASS**(复用 Quote 体系 + gate) |
| ERP PO Number / Requested Delivery | **PASS** |
| Supplier ETA / Receipt | **PASS**(列分离;写入沿用 F3/closed-loop 既有链,自动回填联动待接线 → 该两项如实 **PARTIAL**) |
| Inventory Update | **PASS**(closed-loop 既有) |
| 20K Material / 50K MFG Mapping Scale | **PASS**(真实 16K/52K + 内存 20K/50K) |
| No Silent Truncation | **PASS**(三处 cap 定向化;语料截断显式上报) |
| Tenant Isolation | **PASS**(金样安全矩阵沿用) |
| ERP Lab Contract | **PASS**(16 操作,验收 8/8) |
| Supplier / Customer Alias Resolution | **BLOCKED_DATA**(对照表待乾创;机械 override 实证链路可用) |
| Kingdee Live API | **BLOCKED_EXTERNAL**(WAITING_FOR_DOCUMENTATION,骨架就位) |
