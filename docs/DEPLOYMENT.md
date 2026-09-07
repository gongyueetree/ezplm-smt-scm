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
| `NEXT_PUBLIC_BASE_PATH` | — | 子路径部署,如 `/scm` | 根路径部署。⚠ **构建期生效**,见第六节 |
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
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` / `SMTP_SECURE` | — | 公司 SMTP(E7) | 未齐时状态 `WAITING_FOR_CREDENTIALS`,邮件一律停在「草稿 · 未发送」 |
| `ERP_LAB_BASE_URL` / `ERP_LAB_ACCESS_TOKEN` | — | ERP **仿真环境**(F4,`ezplm-erp-lab` 部署地址与访问令牌;仅服务端) | 未配置时一切 ERP 同步状态为 `NOT_CONFIGURED`,Excel 模板兜底链不受影响。**这是联调靶场,不是金蝶** —— 配置后 UI 仍标「仿真环境」 |
| `ATTACHMENT_MAX_MB` | — | 流式上传单文件上限(MB) | 默认 100 |

#### SMTP:客户已提供的参数(2026-08 回复清单第 3 项)

按客户填写,部署时配置如下 —— **密码/授权码尚未提供,配齐之前发信保持草稿态**:

| 变量 | 客户提供的值 | 备注 |
|---|---|---|
| `SMTP_HOST` | `smtp.qiye.aliyun.com` | 阿里企业邮箱 |
| `SMTP_PORT` | **待确认** | 客户同时写了 `25` 与 `SSL/TLS: 465`,互相矛盾 —— 已列入待澄清;建议 465 + `SMTP_SECURE=true` |
| `SMTP_USER` / `SMTP_FROM` | `buyer1@primatronics.com.cn` 等 **3 个采购账号** | ⚠ 当前实现为**单账号**;按采购员分账号发信是新需求,已列入待澄清(先用哪个账号起步 / 是否要多账号) |
| `SMTP_PASSWORD` | **待提供** | 授权码;**只进环境变量,不进版本库与文档** |

### 初始化物料库(BOM 匹配的第一顺位)

BOM 匹配按 客户料号 → 内部料号 → 精确 MPN → **本地库型号相似** → ezPLM → DigiKey/Mouser 的顺序出候选。
本地物料库为空时,工程侧 BOM(只有 Value)每一行都会落到"无候选"。先灌一批常用料:

```bash
pnpm seed:parts                              # 默认 50 条,每个型号家族取 2 条
pnpm seed:parts -- --limit 100 --per-keyword 3
```

要求已配置 `EZPLM_API_BASE_URL` / `EZPLM_API_KEY`;未配置时脚本**拒绝执行**,
不会用 Mock 数据冒充主数据。抓下来的记录 `sourcedFrom=EZPLM`、`internalPn=EZP-<MPN>`,
标明它是 ezPLM 的**只读缓存**而非自有主数据。

> 实测:ezPLM 的 API Key 接口是**白名单原厂库**,`MIC5504`/`STM32F103` 这类型号家族命中良好,
> 而 `0603`/`电容` 返回 0 条 —— 库里基本没有通用阻容感。脚本的关键字表据此只列 IC/有源器件家族。

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

## 二、推送到 GitHub

### 2.1 先自检:密钥没有进版本库

```bash
git check-ignore -v .env.local          # 必须命中 .gitignore 规则
git ls-files | grep -i env              # 只应出现 .env.example / scripts/*env*.ts
```

`.gitignore` 覆盖 `.env` 与 `.env.*`(仅放行 `.env.example`)。
**仓库建议设为 Private**:`legacy-static/` 与 `docs/customer-feedback/`、`docs/SPEC.pdf`
含客户原件与业务细节,不适合公开。

### 2.2 换到新账号的仓库

`origin` 目前仍指向旧账号(`eehubio/ezplm_smt_full`)。两条路任选:

**A. 用 gh CLI**(需先自行登录;**不要**把 token 贴进任何对话或日志)

```bash
gh auth login
```

登录后建仓并推送:

```bash
gh repo create <新账号>/ezplm-smt-scm --private --source=. --remote=origin --push
```

若 `origin` 已存在会报错,先改指向再推:

```bash
git remote set-url origin https://github.com/<新账号>/ezplm-smt-scm.git
git push -u origin main
git push -u origin feature/nextjs-agent-v1
```

**B. 网页建空仓库**(New repository,不要勾 README/.gitignore/License),然后执行上面的
`git remote set-url` + 两条 `git push`。

> HTTPS 推送时 GitHub 要的密码是 **Personal Access Token**(Settings → Developer settings →
> Tokens),不是账号密码。让 git 记住它:`git config --global credential.helper osxkeychain`。

**首次推送若报 `send-pack: unexpected disconnect while reading sideband packet`**:
git 默认用 chunked 上传 pack,部分网络/代理会把分块传输掐断(表现为鉴权明明通过、
`POST git-receive-pack (chunked)` 之后直接断)。改成按 Content-Length 一次性上传即可:

```bash
git config http.postBuffer 524288000
```

本仓库已写入该配置(2026-07-29 实测:加之前必断,加之后一次推送成功)。

### 2.3 分支现状

`main` 是旧账号仓库的历史;开发成果全在 `feature/nextjs-agent-v1`(领先 `main` 数十个提交)。
新账号下若想让默认分支就是当前代码,推完后在 GitHub 仓库 Settings → Branches 把默认分支
改成 `feature/nextjs-agent-v1`,或本地先 `git switch main && git merge feature/nextjs-agent-v1`
再推 `main`。

---

## 三、Railway(推荐:一处跑全功能)

Railway 跑的是**长驻容器**(直接用仓库根目录的 `Dockerfile`),这正好避开 Vercel 的两处硬限制:

| 本系统的需求 | Vercel(Serverless) | Railway(容器) |
|---|---|---|
| 附件 / 原始 BOM 文件落盘 | 文件系统只读,必须改用 Vercel Blob | 挂持久卷即可,`FILE_STORAGE_PROVIDER=local` 直接可用 |
| 大 BOM 分批导入 + SSE 进度流 | 函数有执行时长上限,长流易被切断 | 无函数超时 |
| PDF 文本层重建 / occt WASM 3D | 冷启动与内存吃紧 | 常驻进程,首次之后即热 |
| PostgreSQL | 需外挂(Neon 等) | 面板一键加 |

### 3.1 部署步骤

1. New Project → **Deploy from GitHub repo** → 选刚推上去的仓库、分支
   `feature/nextjs-agent-v1`;Railway 检测到 `Dockerfile` 会直接用它构建(镜像内已固定
   `BUILD_STANDALONE=1`,并在启动时执行 `prisma migrate deploy`);
2. 同项目里 **+ New → Database → PostgreSQL**;
3. 应用服务的 Variables 里加:

   | 变量 | 值 |
   |---|---|
   | `DATABASE_URL` | 引用数据库服务的 `${{Postgres.DATABASE_URL}}` |
   | `AUTH_SECRET` | `openssl rand -base64 32` 生成的强随机值 |
   | `FILE_STORAGE_PROVIDER` | `local` |
   | `FILE_STORAGE_DIR` | `/app/.storage` |
   | `CRON_SECRET` | 另一个强随机值 |
   | 三方 Key | 按需填 `EZPLM_*` / `DIGIKEY_*` / `MOUSER_API_KEY` / `GEMINI_API_KEY` |

4. Settings → **Volumes** 新建卷,挂载点 `/app/.storage`
   —— **不挂就会在每次重建后丢附件与原始 BOM 文件**;

   > Railway **拒绝含 `VOLUME` 指令的 Dockerfile**(构建期直接报
   > `docker VOLUME at Line N is not supported, use Railway Volumes`),
   > 故本项目 Dockerfile 不写 `VOLUME`,由 `tests/unit/dockerfile-portability.test.ts` 看守。
   > 持久化本来也不靠该声明:自建主机用 `-v ezplm-storage:/app/.storage`,Railway 用上面这个卷。

5. Settings → Networking → **Generate Domain** 得到公网地址;
6. 灌种子(演示账号 + 示例物料):**从运维机器连库执行,不在容器内跑**。

   ```bash
   pnpm seed:remote
   ```

   脚本(`scripts/seed-remote.sh`)交互式索取连接串与演示口令,**输入不回显、不进 shell 历史**,
   写库前先显示 `host:port/dbname` 让人确认。想先只校验不写库:`pnpm seed:remote --dry-run`。

   - 连接串取 Postgres 服务的 **`DATABASE_PUBLIC_URL`**(主机名含 `proxy.rlwy.net`);
     `DATABASE_URL` 是 `postgres.railway.internal`,只能容器内访问 —— 脚本会直接拒绝并提示;
   - **公网部署必须设强口令**;脚本拒绝空口令与仓库里公开的缺省 `demo1234`;
   - SSL 报错时 URL 末尾加 `?sslmode=require`;
   - `prisma/seed.ts` 用 dotenv 且**不覆盖**已存在变量,故传入的 `DATABASE_URL` 会生效,
     不会误灌本地开发库;
   - 表结构已由容器启动时的 `migrate deploy` 建好,这一步只灌数据;
   - 护栏由 `tests/unit/seed-remote-guards.test.ts` 看守(全部走 `--dry-run`,不连库)。

   > 不要手拼等效的一行命令 —— zsh 的 `read "VAR?prompt"` 语法配上嵌套引号极易把 URL 当成
   > 变量名(实测报 `zsh: not an identifier: postgresql:...`)。

   **为什么不在容器里跑**(实测结论,2026-07-29):运行层是 standalone 产物,
   **不含应用源码**(没有 `lib/`、没有 `tsconfig.json`),而 `prisma/seed.ts` 依赖
   `../lib/auth/password` 与 `../lib/server/audit`,容器内必然 `Cannot find module`。
   这与「生产禁跑演示种子」的守卫方向一致 —— **不要**为了灌演示数据把源码塞进生产镜像。
   容器内仍保留 `./node_modules/.bin/prisma migrate deploy` 能力(entrypoint 正是用它),
   镜像也已把 `/app/node_modules/.bin` 加进 `PATH`(否则 Prisma spawn `tsx` 会 ENOENT)。

7. **不要在平台上写死 `PORT`**:Railway 运行时会注入自己的 `PORT`(实测 8080),
   `server.js` 跟随环境变量。手工设成 3000 会造成代理端口与监听端口错配,直接打不开。

### 3.2 定时任务

Railway 的 Cron Schedule 是「按时**启动一个服务**」,不是「按时发一个 HTTP 请求」。
加一个最小服务(镜像 `curlimages/curl`)、Cron 设 `0 1 * * *`、启动命令:

```bash
curl -fsS -X POST https://<你的域名>/api/cron/opo-reminders -H "Authorization: Bearer $CRON_SECRET"
```

---

## 四、Vercel(开发 / Preview)

1. Import GitHub 仓库,Framework 自动识别为 Next.js;
2. **Region 选 `sin1`(新加坡)** —— 大陆访问相对最好(`vercel.json` 已固定);
3. 环境变量按 Preview / Production 分别配置,**不要共用同一套 Key**;
4. 数据库:Preview 用 Neon / Vercel Postgres,生产**不要**用 Vercel 侧数据库(见第五节);
5. 字体:项目使用系统字体栈(`-apple-system / PingFang SC / Microsoft YaHei`),
   **不引任何外部字体服务**,符合 SPEC §18「自托管字体」且避免大陆访问阻塞。

### 4.1 Vercel 上必须改的三处(否则功能会缺)

| 项 | 为什么 | 怎么配 |
|---|---|---|
| 文件存储 | Serverless 文件系统**只读**,`local` provider 会写失败 | Storage → 建 Blob store,设 `FILE_STORAGE_PROVIDER=vercel-blob` 与 `BLOB_READ_WRITE_TOKEN` |
| 数据库迁移 | 构建**不会**自动 `migrate deploy` | 本地对着生产库跑一次 `DATABASE_URL=<生产串> pnpm db:deploy`,或在 Build Command 前置该命令 |
| 定时任务 | Vercel Cron **只发 GET** | `vercel.json` 已配 `crons`(每日 01:00 UTC = 北京 09:00);再设 `CRON_SECRET`,Vercel 会自动带 `Authorization: Bearer $CRON_SECRET` |

数据库用 Neon / Supabase 这类外部托管 PostgreSQL,连接串填 `DATABASE_URL`
(Serverless 建议用带连接池的那个串)。

⚠ **大陆可达性**:`*.vercel.app` 在大陆访问不稳定,Vercel 无大陆节点。
Vercel 仅用于团队开发与演示;**客户 UAT 与生产走第五节的 Docker 路径**。

---

## 五、Docker(客户 UAT / 生产,国内主机)

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

## 六、子路径部署(挂 ezPLM 域名反代)

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

## 七、数据库迁移

| 场景 | 命令 | 说明 |
|---|---|---|
| 开发改 schema | `pnpm db:migrate` | 生成并应用 migration |
| 生产 / CI 应用 | `prisma migrate deploy` | 只应用已有 migration;容器 entrypoint 自动执行 |
| 校验 schema | `pnpm db:validate` | 每个 PR 必跑 |
| 本地开发库 | `pnpm db:start` / `pnpm db:stop` | Homebrew postgresql@17,端口 5433,数据在 `.pgdata/` |

⚠ **migration SQL 生成后不得手改**;需要调整就改 schema 重新生成。

### 构建期不得依赖 DATABASE_URL

Next 构建期(collect page data)会 import 每一个路由模块。Prisma 客户端因此必须**懒构造**
(`lib/server/db.ts` 用 Proxy 延迟到首次属性访问),否则没有 `DATABASE_URL` 的构建环境会整个失败:

```
[Error: Failed to collect page data for /api/auth/logout]
Error: DATABASE_URL 未配置(仅存服务端环境变量)
```

由 `tests/unit/db-lazy-client.test.ts` 看守两条:①无连接串时 import 不抛错;
②**生产下仍是单例** —— 懒构造若只查 `globalThis`(那是给开发热重载的),
生产下每次属性访问都会新建客户端与 pg 连接池,连接数迅速打满。

自查(推荐在提交前跑一次,等价于云端构建环境):

```bash
mv .env .env.bak && mv .env.local .env.local.bak && pnpm build; mv .env.bak .env && mv .env.local.bak .env.local
```

---

## 七之一、自助注册(演示期开放)

未登录用户可在 `/register` 自己建账号,注册即登录。**默认关闭**,需显式打开:

| 环境变量 | 值 | 说明 |
|---|---|---|
| `ALLOW_SELF_REGISTRATION` | `true` | 开放注册。**只有精确的 `true` 算开启**,`1`/`yes`/`TRUE` 都当关闭 |
| `SELF_REGISTRATION_TENANT_SLUG` | 默认 `qianchuang` | 注册账号加入哪个租户 |

关掉的方法:把 `ALLOW_SELF_REGISTRATION` 删掉或改成别的值,重启服务。
关闭后 `/register` 显示「注册未开放」,接口回 403,登录页的注册入口仍在但点进去是提示页。

**默认关闭是刻意的**:开着就意味着任何拿到网址的人都能建号并看到该租户的全部演示数据。
演示期打开、测试结束关掉,比"默认开着等人记得关"安全。

注册规则:

- 邮箱**规范化后**(去空白 + 全小写)判重,已存在一律 409 —— **绝不 upsert**。
  演示账号不可能被"注册同名邮箱"夺走;并发下由 `@@unique([tenantId, email])` 兜底;
- 角色注册时自选(PM / 采购 / 工程 / 管理层 / 供应商),与演示账号共用同一套演示数据;
- 选**供应商**角色必须指定所属供应商 —— 没有归属的供应商账号登录后追溯与在途查询一律被拒,
  看上去就像系统坏了;
- 口令至少 8 位,拒绝 `demo1234` 等演示/弱口令;
- 每次注册写 AuditLog(`USER_SELF_REGISTER`),记邮箱/姓名/角色/供应商,**不记口令**。

⚠ 开放注册时,`/api/auth/register` 的 GET 会向**未登录访问者**返回供应商名称清单
(注册供应商账号必须选归属)。关闭注册后该接口一并关闭。若部署给真实客户且供应商名单敏感,
请保持注册关闭、由管理员建号。

## 七之二、重设账号口令

口令以 bcrypt 存储,**无法找回**,只能重设。重跑种子也不会重置已有账号的口令
(种子的 upsert 只有 `update: { name }`)。

```bash
pnpm reset:password                                     # 交互式:列账号 → 选 → 隐藏输入
pnpm reset:password pm@example.com                      # 指定账号
pnpm reset:password --domain demo.qianchuang.cn         # 批量:该域名下所有启用账号设同一口令
```

对**远端库**做非交互重设时,用下面两种之一 —— 口令不进命令行、不进 shell 历史:

```bash
echo -n '<口令>' | DATABASE_URL=<远端串> pnpm reset:password --domain <域名> --password-stdin
```

```bash
NEW_PASSWORD_FILE=/path/to/secret DATABASE_URL=<远端串> pnpm reset:password --domain <域名>
```

⚠ `--password <明文>` 会把口令写进进程命令行。Linux 下 `/proc/<pid>/cmdline`
**同主机任何用户可读**,还会留在 shell 历史里。因此目标是远端库时脚本会**直接拒绝**,
除非显式加 `--allow-insecure-cli-password` 认领这个风险(仅适用于本来就要发给客户的演示口令)。

脚本每次会先打印目标库的 `host:port/dbname`(不含用户名口令)——
**先确认改的是哪个库**,改错库会让人以为已生效而线上依旧登不进去。
每次重设都写 AuditLog,并记录口令来源(隐藏输入 / 管道 / 文件 / 环境变量 / 命令行),不记口令内容。

> 尚未实现:用户自助改密、忘记密码、管理员 UI 重置、首次登录强制改密。
> 会话是 8 小时无状态 JWT,**重设口令不会让已登录的会话立即失效** ——
> 账号疑似泄露时请同时轮换 `AUTH_SECRET`(会踢掉全部在线会话)。

## 七之三、清理演示数据(保留基线)

客户测试一段时间后单据堆积,影响下一轮演示。用这个脚本清掉**测试期产生的业务单据**,
保留物料、供应商、客户、库存与在途快照、模板与配置,以及**全部账号**(含自助注册的新账号)。

```bash
pnpm demo:reset
```

上面这条**只统计不删** —— 会逐表列出各会删多少条,先看清楚。确认后:

```bash
pnpm demo:reset --apply --as management@demo.qianchuang.cn
```

对线上库操作时在前面加 `DATABASE_URL=<远端串>`。

| 参数 | 说明 |
|---|---|
| `--apply` | 真删。**不加就什么都不会删** |
| `--as <邮箱>` | 执行人,`--apply` 时必填。审计的 userId 不可空,随手挂到某个管理层账号上等于伪造「是他干的」 |
| `--yes` | 跳过 `yes` 二次确认(CI 用) |
| `--include-audit` | 连审计日志一起清(默认保留) |
| `--tenant <slug>` | 指定租户,默认 `qianchuang` |

护栏:

- 先打印目标库 `host:port/dbname`(不含用户名口令);
- 表分类必须**穷尽**(`lib/domain/demo-reset-plan.ts`)。schema 新增了表却没分类时**拒绝执行** ——
  宁可不跑,也不要留下一张谁都没想起来的表。`tests/unit/demo-reset-plan.test.ts` 拿真实
  Prisma 模型清单校验,忘了分类会在 CI 就红;
- 全程 tenant scoped,多租户部署下不会波及别的租户;
- 清理动作本身写 `DEMO_DATA_RESET` 审计,含逐表条数与执行人。

清完之后系统立刻还能演示 —— 物料主数据与配置都在,不是一个空壳。

## 八、定时任务(催办)

SPEC §14:每日扫描 `nextReminderAt`,提前 4 天催办。

```bash
curl -X POST https://your-domain/api/cron/opo-reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

接口 **GET 与 POST 同效**(同一套 `CRON_SECRET` 校验):Vercel Cron 只发 GET,
自建 crontab 习惯用 POST,两边都能调。

- Vercel:`vercel.json` 已配 `crons`,再设 `CRON_SECRET` 即生效(Vercel 自动带 Bearer 头);
- 国内主机:用系统 crontab 或云厂商定时任务调用上述接口;
- **未配置 `CRON_SECRET` 时接口返回 503 拒绝运行** —— 不接受无鉴权触发;
- 幂等键 = 行 ID + ETA + 当天日期,同日重复触发不会重复生成催办记录。

⚠ **当前催办只生成记录(状态 PENDING),不发送真实邮件** —— 邮件通道为预览/模拟,
接入真实邮件服务属后续工作,页面与接口响应均已如实标注。

---

## 九、上线前检查清单

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

## 九之二、上线后功能自查清单(六批整改)

部署完成后按此表逐项打开,即可确认该批是否真的上线。任一页打不开或看不到对应元素,
说明镜像不是最新的 —— 回看 Deploy Logs 里 `migrations found` 的数量是否与
`prisma/migrations` 目录一致。

| 批次 | 验收入口 | 看到什么算上线 |
|---|---|---|
| 1 报价页整改 | 报价详情 → 打印视图 | 「需求方(甲方)」「商务条款」「替代料 MFG / MPN」列 |
| 2 BOM 台账 | `/bom`、`/bom/imports` | 「EOL 物料占用 BOM」「超期未更新 BOM」两张卡片;导入历史台账 |
| 3 物料与库存 | `/materials`、`/inventory`、`/settings/sync-log` | 「SMT 工艺(MSL / 包装 / 盘装)」列;库存页客户/日期筛选;ERP 同步日志 |
| 4 批量报价与损耗 | `/quotes`、`/scrap` | 「批量 update 报价」按钮;损耗报告页 |
| 5 客户分级 | `/settings/quote-templates` | 报价模板表 + 「客户等级与命中的模板」推演表 |
| 6 供应商协同 | `/suppliers/collab` | 「供应商协同」页,且全页无「已发送」字样 |

### 迁移与提交的对应关系

容器启动时跑 `prisma migrate deploy`,**任一迁移失败即拒绝启动**(不接受用未迁移的库跑)。
六批各自带的迁移:

```
20260730073140_import_job_file_names          批次2
20260730160052_part_process_attr              批次3
20260730163547_quote_batch_and_scrap          批次4
20260730164843_customer_tier_quote_template   批次5
20260730170207_supplier_collab                批次6
```

Deploy Logs 里 `N migrations found` 的 N 应与 `ls prisma/migrations | wc -l` 一致。

### ⚠ Redeploy 不会拉新代码

Railway 的 **Redeploy 是"用同一个提交再部一次"**,不会去取分支最新提交。
若某次推送的 webhook 未被处理(例如平台故障期间),Deployments 列表里不会出现该提交,
此时点任何现有部署的 Redeploy 都无济于事 —— **需要推一个新提交**触发构建。

---

## 九之三、把客户在用的域名切到新系统(域名迁移手册)

> 背景(2026-08-01 实测):`erp.tindie.com` 当时指向 **Vercel**,服务的是
> 2026-07-05 手动上传的**静态原型**(页面 `_next` 引用 0 处、`/login` 返回 404)。
> 而真正的系统跑在 Railway。客户按老链接测了很久,测的一直是原型。
>
> 本节记录如何把这个域名切到 Railway,**且不让客户改链接**。

### 1. 为什么不把系统部署到 Vercel

不是配置问题,是架构冲突(见第四节 4.1):Serverless 文件系统只读、函数有执行时长上限、
WASM 冷启动吃紧。附件上传与大 BOM 导入这两条主线在 Vercel 上都会出问题。
**切域名比迁平台省事得多,也没有这些限制。**

### 2. 顺序很重要

**先在 Railway 加域名 → 再改 DNS → 验证通过 → 最后从 Vercel 移除。**

顺序反了会中断服务:先从 Vercel 摘掉域名,在 DNS 生效前该域名会直接打不开;
而按上面的顺序,切换期间最坏情况只是"有人看到旧站",不会白屏。

#### 第 1 步:Railway 侧登记域名

Railway → 目标服务 → **Settings → Networking → Custom Domain** → 填 `erp.tindie.com`。

Railway 会给出一条 CNAME 目标(形如 `xxxx.up.railway.app`),并显示
**Waiting for DNS** —— 这是正常的,此时 DNS 还没改。

#### 第 2 步:改 DNS(本项目在 Cloudflare)

`tindie.com` 的 NS 是 `leia.ns.cloudflare.com` / `woz.ns.cloudflare.com`,
所以在 **Cloudflare** 控制台改,不是在域名注册商那里。

把 `erp` 这条记录改成:

| 字段 | 值 |
|---|---|
| 类型 | `CNAME` |
| 名称 | `erp` |
| 目标 | Railway 给的那条 `xxxx.up.railway.app` |
| 代理状态 | **DNS only(灰云)** |
| TTL | Auto |

> ⚠️ **Cloudflare 特有的坑:代理状态必须先设成「DNS only」(灰云)。**
>
> 开着橙云时,Cloudflare 会代理流量并自己终止 TLS,
> Railway 看到的不是真实解析结果,**证书签发会一直卡在 pending**。
> 等 Railway 证书签发成功、站点能正常访问之后,再决定是否开回橙云;
> 若要开橙云,Cloudflare 的 SSL 模式必须是 **Full (Strict)** ——
> 用 Flexible 会造成"Cloudflare 到 Railway 走明文",且容易出现重定向循环。

#### 第 3 步:等证书

Railway 侧状态会从 **Waiting for DNS** → **Issuing certificate** → **Active**。
通常几分钟,偶尔十几分钟。

**证书签发完成前,HTTPS 访问可能报证书错误** —— 这是预期现象,不要在这个阶段回滚。

#### 第 4 步:验证(不要只看浏览器)

浏览器有缓存和 HSTS,看着"没变"未必是真没变。用命令确认:

```bash
dig +short erp.tindie.com && curl -sI https://erp.tindie.com/login | head -3
```

判定标准:

| 检查 | 切换成功的表现 |
|---|---|
| `dig` 结果 | 指向 Railway,**不再**出现 `vercel-dns` |
| `/login` 状态码 | **200**(旧的静态原型这里是 404) |
| 响应头 | 出现 `x-railway-*`,**不再**有 `x-vercel-*` |
| 页面标题 | `ezPLM · AI 供应链协同` |

再补一条内容级验证(避免"域名切了但部署是旧的"):

```bash
curl -s https://erp.tindie.com/login | grep -c "_next"
```

**大于 0** 才说明服务的是 Next.js 系统而不是静态 HTML。

#### 第 5 步:从 Vercel 移除该域名

确认第 4 步全部通过后,Vercel → 项目 → **Settings → Domains** → 移除 `erp.tindie.com`。

**不移除会怎样**:Vercel 仍认为自己拥有该域名,后续若有人误改 DNS 或
Vercel 侧做了重定向配置,可能把流量抢回去。切换完成后应尽快摘掉。

### 3. 切换期会发生什么

DNS 有缓存,不同网络的用户不会同时切过去。这段时间内:

- 一部分用户看到**新系统**(Railway);
- 一部分用户看到**旧的静态原型**(Vercel);
- **不会白屏**,因为两边都还在服务。

这个窗口通常几分钟到一小时。若想缩短:改 DNS **之前**先把该记录的 TTL 调到 60 秒,
等一个旧 TTL 周期后再改目标。

> 客户正在测试期间切换时,**提前打招呼**比事后解释省事 ——
> 他们看到界面突然变了会以为出故障。

### 4. 回滚

把 Cloudflare 里 `erp` 的 CNAME 改回 Vercel 的目标即可
(切换前**先把原值抄下来**,本次实测原值是 `d1b22c3c88353251.vercel-dns-016.com`)。

只要第 5 步还没做(域名仍留在 Vercel 项目里),回滚就是改一条 DNS 记录的事。
**这也是为什么第 5 步要放在最后。**

### 5. 常见故障

| 现象 | 原因与处理 |
|---|---|
| Railway 一直 Waiting for DNS | Cloudflare 开着橙云 → 改成 DNS only(灰云) |
| 证书报错、访问不了 | 证书还在签发中,等几分钟;超过 20 分钟检查 CNAME 是否写对 |
| 浏览器仍显示旧站 | 本地 DNS 缓存或 HSTS;用 `dig` 与 `curl` 判定,别信浏览器 |
| 重定向循环 | Cloudflare SSL 模式是 Flexible → 改 **Full (Strict)** |
| `/login` 是 200 但页面是旧原型 | 域名切对了,但 Railway 上部署的是旧提交 → 看 Deploy Logs 与迁移数量 |

---

## 十、当前未接通的外部依赖(如实记录)

| 依赖 | 状态 | 影响 |
|---|---|---|
| ezPLM 只读 API | **待联调** | 物料/库存走 Mock,页面标注「示例数据」 |
| DigiKey / Mouser | **已联调**(2026-07-27 用户执行 `pnpm smoke:external` 验证) | 配置 Key 后即走真实 API |
| AI 模型(Gemini / Claude) | **已联调**(2026-07-28 用户配置 `GEMINI_API_KEY` 后执行 `pnpm smoke:ai` 验证:连通性、QuoteAgent 分类建议、图片 BOM 转写三项全通) | 供 ①报价 QuoteAgent 分类/Markup 建议 ②图片/扫描件 BOM 转写 两处使用。无 Key 时降级为本地规则,UI 标注「未接入模型」 |
| 邮件发送(催办 / 对账) | **未接入** | 只生成记录,不发送 |
| ERP 回写 | **替代路径** | 生成 ERP 可导入 XLSX + IntegrationJob 登记;RPA/API 直写属二期 |

---

## 十一、SPEC §17 测试清单覆盖对照

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
