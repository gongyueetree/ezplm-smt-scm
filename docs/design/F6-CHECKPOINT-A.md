# F6-B 检查点 A · 客户门户 Shell —— 隔离设计

> 按 KICKOFF_ROUND2.md §F6【补充】要求先行交付。随 PR 评审;异议以批注为准返工。
> 本 PR 只做 Shell + 安全边界,**不猜最终字段**(字段规则以客户确认为准)。

## 1. 独立认证域

| 维度 | 内部系统 | 客户门户 |
|---|---|---|
| Cookie 名 | `scm_session` | `portal_session` |
| 签名密钥 | `AUTH_SECRET` | `PORTAL_AUTH_SECRET`(**独立环境变量**;未配置时门户整体 503,不回落共用) |
| 载荷 | userId/tenantId/roles | portalAccountId/tenantId/customerId(**无 roles,无 userId**) |
| TTL | 8h | 4h(外部用户从紧) |

**互不接受**:
- 内部 API/页面只验 `scm_session`(现状不变)—— 门户 cookie 名字不同、密钥不同,天然无法通过;
- `/portal` 与 `/api/portal` 只验 `portal_session`;拿内部 cookie 访问 /portal 数据 → 401;
- 两个域的 JWT 载荷结构不同,即使密钥被错误配置成同值,载荷校验也会拒绝(portal 载荷必须含 `portalAccountId` 且**不得含 roles**)。

## 2. 账号模型与准入

- `PortalAccount`(tenantId、customerId、email 租户内唯一、passwordHash(scrypt)、active、invitedById、lastLoginAt);
- **仅内部 MANAGEMENT 邀请建号**(设置页/API),无自注册路径;
- 双开关:环境变量 `CUSTOMER_PORTAL_ENABLED=1` **且** 租户 flag `customerPortal` —— 任一关闭,/portal 与 /api/portal 一律 404(功能不存在,不是无权限);
- 登录限速复用 F3 的滑动窗口(每 IP 每分钟 10 次)。

## 3. 数据边界(DTO 白名单,非前端隐藏)

- 门户可见:`materialCode`、数量、仓库、批次、数据更新时间 —— 序列化层白名单函数逐字段挑出,**不存在把整行对象直接 JSON 的路径**;
- 绝对禁止出现:采购价/供应商/供应商报价/毛利/PPV/其他客户数据/内部备注/管理看板/采购备注;
- 「我的库存」数据源 = ErpProvider.pullInventory 按本客户 `Customer.code == ErpInventory.customerCode` 过滤(Lab 已带该维度);ERP 未配置 → 空态「待接入」,**不显示 0**;
- Transactions / Lots:数据源未接入,本 PR 只有空态页(不造数);
- Exports:CSV 只含白名单字段,按 customer scope。

## 4. 路由与中间件

| 路由 | 说明 |
|---|---|
| `/portal/login` | 门户登录页(公开) |
| `/portal` + 子页 | Overview / inventory / transactions / lots / exports(portal 会话) |
| `/api/portal/auth/login` / `logout` | 登录/登出(公开/portal 会话) |
| `/api/portal/inventory` `/api/portal/export` | 数据接口(portal 会话 + customer scope) |

中间件:`/portal`、`/api/portal` 从内部会话检查中排除,改由 portal 布局/路由自行验 `portal_session`;
门户用户**不进入** SEARCH_SCOPES 与任何内部搜索/列表 API(那些只认内部会话)。

## 5. E2E 隔离矩阵(合并门禁)

1. 客户 A 会话访问客户 B 无从表达(scope 由会话内 customerId 决定,无参数可传)——以「A 的接口只回 A 的 customerCode 数据」断言;
2. 门户会话调内部 API(如 /api/settings/tenant)→ 401;
3. 内部会话访问 /api/portal/inventory → 401;
4. 开关任一关闭 → /portal 404;
5. 导出文件不含禁止字段(断言表头与内容无「价」「供应商」等)。
