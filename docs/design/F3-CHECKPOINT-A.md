# F3 检查点 A · 供应商免登录确认链路 —— Token 安全设计

> 按 KICKOFF_ROUND2.md §F3【补充】要求先行交付。随 PR 一并评审;
> 若对任何一条有异议,以人工批注为准、代码返工。

## 1. Token 生成与哈希

- **生成**:`crypto.randomBytes(32)` → base64url(43 字符,≈256 bit 熵);
- **存储**:数据库只存 `SHA-256(token)` 的 hex(`tokenHash`,唯一索引),**原始 token 不入库**;
  生成后只出现在一次性返回给内部用户的 URL 里;
- **查找**:按 hash 查,常数时间比较交给唯一索引等值查询(输入先哈希,无计时侧信道);
- **日志脱敏**:token 永不写日志/审计;审计只记 `tokenHash` 前 8 位便于对账。

## 2. 有效期与重放策略

- 默认 **14 天**,创建时可指定 1–60 天;过期访问返回 **410**(页面如实说明「链接已过期,请联系采购重新发送」);
- **单次响应**:提交用条件更新 `updateMany(status=PENDING → RESPONDED)`,
  命中 0 行即已被响应 → **409**,页面显示「该链接已确认过」**且不再展示任何业务数据**;
- 未知 token 一律 **404**,与「存在但无权」不可区分(防枚举);
- 内部可 **REVOKE**(如误发),被撤销链接同 404 处理(不解释原因)。

## 3. 公开路由清单与中间件排除

| 路由 | 方法 | 说明 |
|---|---|---|
| `/confirm/[token]` | GET | 公开确认页(独立 route group `app/(public)/`,不挂内部 AppShell) |
| `/api/confirm/[token]` | POST | 提交响应(zod 校验 + 速率限制) |

中间件 `PUBLIC_PATHS` 增加 `/confirm`、`/api/confirm` 两个前缀;其余路径鉴权不变。
**token 放 URL 路径而非查询串**(降低日志/Referer 泄露面);页面加 `<meta name="referrer" content="no-referrer">`。

## 4. 速率限制

- 公开 POST 走进程内滑动窗口:**每 IP 每分钟 30 次**,超限 429;
- 这是单实例兜底 —— 生产多实例/边缘限流属部署层(Railway/Cloudflare),已记入 DEPLOYMENT.md;
- GET 页面不限(静态渲染成本低,404 均一化已防枚举)。

## 5. 最小字段清单(公开页可见内容)

| 场景 | 展示 | 刻意不展示 |
|---|---|---|
| PO_CONFIRM | PO 号、供应商名、行(行号/MPN/数量/需求日期) | **单价与金额**、内部备注、其它供应商、任何内部链接 |
| OPO_ETA | 该供应商的开口行(PO号/行号/MPN/未交数量/原承诺交期) | 单价、需求日期之外的内部字段 |

响应方姓名/邮箱为**自述**,记录用,不作身份凭据;IP/UA 记入审计(同样只作事后核查)。

## 6. 数据落点(复用,不建平行表)

- 请求:新表 `SupplierActionRequest`(kind/supplierId/relatedEntity/tokenHash/expiresAt/status/responsePayload/响应人自述/IP/UA);
- **事件**:复用 AuditLog(`SUPPLIER_ACTION_CREATED` / `SUPPLIER_ACTION_RESPONDED`),不建 Event 表;
  公开响应无内部 userId,审计 userId 记创建者,`after.respondedVia="SUPPLIER_LINK"` 标明实际来源;
- PO 确认 → 既有 `PoAcknowledgement`(source=`LINK`)+ PO 详情页显示「Supplier Confirmed via Link」;
- OPO ETA → 既有 `OPOReply`(**ReplySource 枚举新增 `LINK`**),不建平行回复表;
- **F4 联动**:ETA 确认后仅把 `IntegrationSyncRecord(ETA_WRITEBACK, opoLineId)` 置 PENDING(待回写),**不自动触发同步**。

## 7. 状态语义(单测锁定,不可互推)

`EMAIL_SENT`(OutboundMessage,E7)/ `READ_RECEIPT_*`(E7)/ `SUPPLIER_CONFIRMED`(本表 RESPONDED)
三层各自独立:发了≠读了≠确认了。SMTP 未配置时仍可生成链接与邮件草稿,状态停在「草稿·未发送」。

## 8. 链接拼装

`APP_PUBLIC_URL`(含协议与域名)+ Next `basePath` + `/confirm/{token}`;
`APP_PUBLIC_URL` 未配置时返回相对路径并在 UI 注明「请补全域名后再外发」。

## 9. 本轮范围

实现 **PO_CONFIRM 与 OPO_ETA** 两场景端到端;`CALL_MATERIAL` / `RFQ_QUOTE` 进 schema 枚举但
创建接口暂拒(DEFERRED,防止生成无落地页的死链)。
