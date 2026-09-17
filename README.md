# ezPLM AI 供应链协同(Next.js 全栈)

> 本仓库已重构为 Next.js 全栈系统(PR1+)。工作约束见 `CLAUDE.md`,规范见 `docs/SPEC.md`。
> 旧静态原型 `legacy-static/` 已于 2026-09-17 归档移出仓库,取回方式见文末。

## 本地开发

```bash
pnpm install
pnpm db:start      # 本地 PostgreSQL(Homebrew postgresql@17,端口 5433,数据在 .pgdata/)
pnpm db:migrate    # 应用 migration
pnpm db:seed       # 演示种子(五角色账号)
pnpm dev
```

⚠ **演示账号与口令(demo1234)仅限本地/预览环境**:种子脚本在 `NODE_ENV=production` 下拒绝执行;生产环境必须走正式的用户开通流程。

质量门禁(SPEC §18,CI 每次 push 全跑):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:validate && pnpm test:e2e
```

## 部署

双轨交付(见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

- **Vercel**(region `sin1`)= 团队开发 / PR Preview / 内部演示;
- **Docker**(同一份代码)= 客户 UAT 与生产,部署到国内主机 —— `*.vercel.app` 在大陆访问不稳定。

```bash
docker compose -f docker-compose.local.yml up --build   # 本地一体验证
docker build -t ezplm-scm:1.0.0 .                        # 生产镜像
docker build --build-arg NEXT_PUBLIC_BASE_PATH=/scm .    # 子路径反代形态
```

## 外部集成现状(如实)

| 集成 | 状态 |
|---|---|
| DigiKey / Mouser | 已联调(2026-07-27 由用户执行 `pnpm smoke:external` 验证) |
| ezPLM 只读 API | 待联调 —— 走 Mock,页面标注「示例数据」 |
| Claude(QuoteAgent) | 待接入 —— 无 Key 时用本地规则建议,UI 标注「未接入模型」 |
| 邮件发送(催办/对账) | 未接入 —— 只生成记录,不发送 |
| ERP 回写 | 替代路径 —— 生成可导入 XLSX + IntegrationJob 登记;RPA/API 直写属二期 |

---

# 旧静态原型(legacy-static/)—— 已归档移出仓库

2026-09-17(REF-0 清理)将 `legacy-static/`(v5.2.1 静态原型,141 文件 / 8MB)移出本仓库:
它无任何构建或部署依赖,代码中仅有一处注释引用,长期留在仓库里只增加克隆体积与"哪个才是现行实现"的歧义。

它仍然是**客户验收的视觉对照原件**,没有销毁,两种方式可取回:

```bash
# 方式一:仓库外副本
ls ../archive/legacy-static-v5.2.1/

# 方式二:从 git 历史取回(标签指向移除前的最后一次提交)
git checkout archive/legacy-static-last -- legacy-static/
```

取回后**仍禁止修改,也不要再提交回仓库**。设计系统已全部收敛到 `app/globals.css` 的 CSS 变量与 `components/ui`;
原型的业务逻辑已在四轮迭代中翻译为 `lib/domain/` 的确定性函数。
