# 部署与运维手册

> 对应 SPEC §18(CI 与部署)与 INTEGRATION_PLAN 决策 2(双轨交付)。
> **一套代码两种交付**:Vercel = 团队开发 / PR Preview / 内部演示;
> 客户 UAT 与生产 = **同一份代码构建的 Docker 镜像**部署到国内主机。

---

## 一、环境变量总表

| 变量 | 必需 | 说明 | 未配置时的行为 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串 | 应用启动失败(容器 entrypoint 直接退出) |
| `AUTH_SECRET` | ✅ | 会话 JWT(HS256)签名密钥 | 登录/验签抛错。**生产必须为强随机值** |
| `NEXT_PUBLIC_BASE_PATH` | — | 子路径部署,如 `/scm` | 根路径部署。⚠ **构建期生效**,见第四节 |
| `BUILD_STANDALONE` | — | 设 `1` 产出 standalone(Docker 用) | Vercel 部署不需要 |
| `FILE_STORAGE_PROVIDER` | — | `local` \| `vercel-blob` | `local` |
| `FILE_STORAGE_DIR` | — | 本地存储根目录 | `.storage` |
| `BLOB_READ_WRITE_TOKEN` | — | Vercel Blob 令牌 | 选 `vercel-blob` 却未配置时**构造即抛错**,不静默降级 |
| `EZPLM_API_BASE_URL` / `EZPLM_API_KEY` | — | ezPLM 只读 API | 走 MockEzplmProvider,页面标注「示例数据」 |
| `DIGIKEY_CLIENT_ID` / `DIGIKEY_CLIENT_SECRET` | — | DigiKey OAuth | 走 Mock,页面标注 |
| `DIGIKEY_ACCOUNT_ID` / `DIGIKEY_SITE` / `DIGIKEY_LANGUAGE` / `DIGIKEY_CURRENCY` | — | 账户与地区 | 默认 `CN` / `zh` / `CNY` |
| `DIGIKEY_API_BASE_URL` | — | Sandbox 凭据需设为 `https://sandbox-api.digikey.com` | 生产域名 |
| `MOUSER_API_KEY` / `MOUSER_API_BASE_URL` | — | Mouser Search API | 走 Mock,页面标注 |
| `GEMINI_API_KEY` | — | Gemini 模型凭据(**推荐**) | 与 `ANTHROPIC_API_KEY` 都没配时,AI 功能降级为本地规则 |
| `GEMINI_MODEL` | — | Gemini 模型名 | `gemini-2.5-flash` |
| `GEMINI_API_BASE_URL` | — | 自建网关/代理时覆盖 | `https://generativelanguage.googleapis.com/v1beta` |
| `ANTHROPIC_API_KEY` | — | Claude 模型凭据 | 同上 |
| `ANTHROPIC_MODEL` | — | Claude 模型名 | `claude-opus-5` |
| `AI_PROVIDER` | — | 强制指定厂商:`gemini` / `anthropic` / `none` | 按 Gemini → Anthropic 顺序自动选;`none` 可强制关闭 AI |
| `CRON_SECRET` | — | 催办 Cron 鉴权 | **催办接口返回 503 拒绝运行**(不在无鉴权下开放) |
| `SEED_DEMO_PASSWORD` | — | 演示种子口令 | `demo1234`。**种子在 `NODE_ENV=production` 下拒绝执行** |

### AI 模型接入(两处功能共用一套凭据)

```bash
# .env.local(不进版本库)
GEMINI_API_KEY=<你的 Key>
GEMINI_MODEL=gemini-2.5-flash
```

配置后立即生效的功能:

| 功能 | 位置 | 模型做什么 | 模型**不**做什么 |
|---|---|---|---|
| 报价分类与 Markup 建议 | 报价详情页「运行 QuoteAgent」 | 给物料类别 + Markup 档位 | 不算任何金额;单价/小计/总价全部由 `lib/domain/quote-calc.ts` 用 Decimal 计算 |
| 图片 / 扫描件 BOM 转写 | BOM 导入上传图片或无文本层 PDF | 把表格逐字抄成行列 | 不猜型号、不补全、不做单位换算;数量仍由 `parseQty` 重新解析 |

> PDF **有文本层**时不走模型 —— 走 `lib/domain/pdf-table.ts` 的确定性几何重建。
> 模型只在扫描件与图片上使用。

验证:

```bash
pnpm smoke:ai
```

脚本只打印凭据**长度**,不回显任何 Key 内容。输出贴回评审记录后,才可把状态写为「已联调」。

**切勿用 shell 加载 `.env.local`**(如 `. ./.env.local`):
若某行写成 `KEY= value`(`=` 后多一个空格),shell 会把值当命令执行,
Key 原文会出现在 `command not found: <Key>` 里,直接泄进终端历史与 CI 日志。
冒烟脚本已改为**自己解析** `.env.local`(见 `scripts/load-env.ts`),直接 `pnpm smoke:ai` 即可。

**密钥纪律**:所有 Key 只存服务端环境变量;`.gitignore` 覆盖 `.env*`(仅放行 `.env.example`);
日志与 `ApiUsageLog` 中的端点一律经 `redactUrl()` 脱敏(Mouser 的 `apiKey` 走 query,尤其重要)。

---

## 二、Vercel(开发 / Preview)

1. Import GitHub 仓库,Framework 自动识别为 Next.js;
2. **Region 选 `sin1`(新加坡)** —— 大陆访问相对最好(`vercel.json` 已固定);
3. 环境变量按 Preview / Production 分别配置,**不要共用同一套 Key**;
4. 数据库:Preview 用 Neon / Vercel Postgres,生产**不要**用 Vercel 侧数据库(见第三节);
5. 字体:项目使用系统字体栈(`-apple-system / PingFang SC / Microsoft YaHei`),
   **不引任何外部字体服务**,符合 SPEC §18「自托管字体」且避免大陆访问阻塞。

⚠ **大陆可达性**:`*.vercel.app` 在大陆访问不稳定,Vercel 无大陆节点。
Vercel 仅用于团队开发与演示;**客户 UAT 与生产走第三节的 Docker 路径**。

---

## 三、Docker(客户 UAT / 生产,国内主机)

> ⚠ **验证状态**:Dockerfile 与 compose **尚未经真实 `docker build` 验证**(开发机无 Docker)。
> 已验证的部分:`BUILD_STANDALONE=1` 产出的 `.next/standalone/server.js` 可独立启动
> (实测 `/login` 200、受保护页 307)。
> 已发现并修复的一处真实缺陷:standalone 的 `node_modules` **不含 prisma CLI 与 `.bin`**,
> 而 pnpm 的 `.bin/prisma` wrapper 硬编码 `.pnpm/` 绝对路径 —— 只复制 `prisma`/`@prisma`
> 会让容器内 `migrate deploy` 必然失败(已用本地模拟复现报错)。现改为整棵复制构建期依赖树。
> **首次部署前请务必在有 Docker 的机器上跑一次 `docker build` 与 `docker compose up` 验证。**


### 3.1 本地一体验证

```bash
docker compose -f docker-compose.local.yml up --build
# 打开 http://localhost:3000,用种子账号登录(需先跑一次 pnpm db:seed 或在容器内执行)
```

### 3.2 生产部署

```bash
docker build -t ezplm-scm:1.0.0 .
docker run -d --name ezplm-scm \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://USER:PASS@rds-host:5432/ezplm_scm" \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e FILE_STORAGE_PROVIDER=local \
  -e FILE_STORAGE_DIR=/app/.storage \
  -v ezplm-storage:/app/.storage \
  ezplm-scm:1.0.0
```

要点:

- **数据库用外部托管服务**(阿里云/腾讯云 RDS PostgreSQL),不要用 compose 里的容器库;
- 容器启动时自动执行 `prisma migrate deploy`(只应用已生成的 migration,**绝不在生产改 schema**);
  需要跳过时设 `SKIP_MIGRATIONS=1`;
- 应用以非 root 用户运行;`/app/.storage` **必须挂持久卷**,否则重建容器会丢附件与原始 BOM 文件;
- 健康检查探 `/login`(静态页,不依赖数据库),便于区分「应用起来了」与「数据库连不上」。

### 3.3 反向代理(Nginx 示例)

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 25m;   # 附件与 BOM 上限 20MB,留余量
    proxy_read_timeout 300s;    # SSE 进度流
}
```

---

## 四、子路径部署(挂 ezPLM 域名反代)

融合钉子 3:`basePath` 可配,便于将来以 `/scm` 挂在 ezPLM 域名下(L2 体验融合)。

⚠ **`NEXT_PUBLIC_BASE_PATH` 在构建期烘焙进产物**,不能只在运行时设:

```bash
docker build --build-arg NEXT_PUBLIC_BASE_PATH=/scm -t ezplm-scm:scm .
```

对应 Nginx:

```nginx
location /scm/ {
    proxy_pass http://127.0.0.1:3000;
    # 其余 header 同上
}
```

CI 的 `docker-build` job 会同时构建根路径与 `/scm` 两种形态,防止该能力悄悄退化。

---

## 五、数据库迁移

| 场景 | 命令 | 说明 |
|---|---|---|
| 开发改 schema | `pnpm db:migrate` | 生成并应用 migration |
| 生产 / CI 应用 | `prisma migrate deploy` | 只应用已有 migration;容器 entrypoint 自动执行 |
| 校验 schema | `pnpm db:validate` | 每个 PR 必跑 |
| 本地开发库 | `pnpm db:start` / `pnpm db:stop` | Homebrew postgresql@17,端口 5433,数据在 `.pgdata/` |

⚠ **migration SQL 生成后不得手改**;需要调整就改 schema 重新生成。

---

## 六、定时任务(催办)

SPEC §14:每日扫描 `nextReminderAt`,提前 4 天催办。

```bash
curl -X POST https://your-domain/api/cron/opo-reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

- Vercel:用 Vercel Cron 配置每日触发;
- 国内主机:用系统 crontab 或云厂商定时任务调用上述接口;
- **未配置 `CRON_SECRET` 时接口返回 503 拒绝运行** —— 不接受无鉴权触发;
- 幂等键 = 行 ID + ETA + 当天日期,同日重复触发不会重复生成催办记录。

⚠ **当前催办只生成记录(状态 PENDING),不发送真实邮件** —— 邮件通道为预览/模拟,
接入真实邮件服务属后续工作,页面与接口响应均已如实标注。

---

## 七、上线前检查清单

- [ ] `AUTH_SECRET` 已换成强随机值(不是 `change-me`)
- [ ] `DATABASE_URL` 指向外部托管 PostgreSQL,且已备份策略
- [ ] `/app/.storage` 已挂持久卷(或改用对象存储)
- [ ] `.env*` 未进版本库(`git check-ignore -v .env.local` 应命中)
- [ ] 生产环境**未**执行演示种子(`NODE_ENV=production` 下种子会自行拒绝)
- [ ] 域名与备案就绪(生产域名走 ezplm.cn 已备案体系最省事)
- [ ] `CRON_SECRET` 已配置且定时任务已挂
- [ ] 三方 Key 按环境分别配置,未在 Preview 与生产间共用
- [ ] 六项门禁在 CI 上全绿(lint / typecheck / test / build / prisma validate / e2e)

---

## 八、当前未接通的外部依赖(如实记录)

| 依赖 | 状态 | 影响 |
|---|---|---|
| ezPLM 只读 API | **待联调** | 物料/库存走 Mock,页面标注「示例数据」 |
| DigiKey / Mouser | **已联调**(2026-07-27 用户执行 `pnpm smoke:external` 验证) | 配置 Key 后即走真实 API |
| AI 模型(Gemini / Claude) | **已联调**(2026-07-28 用户配置 `GEMINI_API_KEY` 后执行 `pnpm smoke:ai` 验证:连通性、QuoteAgent 分类建议、图片 BOM 转写三项全通) | 供 ①报价 QuoteAgent 分类/Markup 建议 ②图片/扫描件 BOM 转写 两处使用。无 Key 时降级为本地规则,UI 标注「未接入模型」 |
| 邮件发送(催办 / 对账) | **未接入** | 只生成记录,不发送 |
| ERP 回写 | **替代路径** | 生成 ERP 可导入 XLSX + IntegrationJob 登记;RPA/API 直写属二期 |

---

## 九、SPEC §17 测试清单覆盖对照

| # | SPEC §17 E2E 要求 | 覆盖用例 |
|---|---|---|
| 1 | PM 创建 RFQ 并上传多个附件 | `rfq-bom.spec.ts` › PM 创建 RFQ 并上传多个附件 |
| 2 | RFQ 关闭为不报价 | `rfq-bom.spec.ts` › RFQ 不报价关闭 |
| 3 | BOM 导入、匹配、人工确认 | `rfq-bom.spec.ts` › BOM 导入 → 校验 → 匹配 → 人工确认 |
| 4 | 同一 MPN 比较 ezPLM/DigiKey/Mouser/线下报价 | `procurement.spec.ts` › 采购创建比价单并查询多源报价 |
| 5 | 采购选择供应商并反馈 PM | `procurement.spec.ts` › 线下报价导入后固化原始异常,未处理不得反馈 PM |
| 6 | 报价计算、审批、退回、新版本和批准 | `quote.spec.ts` › 审批退回 → 新建 Revision → 再提交 → 批准 |
| 7 | OPO 回复、提醒和 ERP 导出 | `opo.spec.ts` › 记录供应商回复 / 催办 Cron 鉴权 / ERP 模板导出 |
| 8 | 角色切换后菜单和权限变化 | `shell.spec.ts` › 角色切换(退出→采购登录) |
| 9 | API 失败时显示降级信息 | `audit-degrade.spec.ts` › 外部 API 失败时展示降级信息 |
| 10 | 所有关键操作生成 AuditLog | `audit-degrade.spec.ts` › 关键操作生成 AuditLog 并可在系统设置中查验 |

单元测试覆盖 SPEC §17 单测清单:MPN 标准化、GTB、MOQ/SPQ 圆整、价格阶梯选择、
Markup、PPV、报价快照、Offer 排名、OPO 异常日期、tenant 隔离。
