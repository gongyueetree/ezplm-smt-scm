# ============================================================
# ezPLM AI 供应链协同 — 生产镜像(Next.js standalone)
#
# "一套代码两种交付"(整合方案决策 2):
#   Vercel = 开发 / PR Preview;本镜像 = 客户 UAT 与生产(国内主机)
#
# 构建:
#   docker build -t ezplm-scm:latest .
#   # 子路径部署(挂 ezPLM 域名反代时):
#   docker build --build-arg NEXT_PUBLIC_BASE_PATH=/scm -t ezplm-scm:scm .
# ============================================================

# ---------- 1. 依赖 ----------
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- 2. 构建 ----------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# basePath 在**构建期**烘焙进产物(Next.js 限制),故用 build arg 而非运行时变量
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV BUILD_STANDALONE=1
ENV NEXT_TELEMETRY_DISABLED=1

# 构建期不连数据库:Prisma 只需 generate(migrate 在容器启动时执行)
RUN pnpm exec prisma generate
RUN pnpm build

# ---------- 3. 运行 ----------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# PORT 是**默认值**:Railway 等平台会在运行时注入自己的 PORT(实测注入 8080),
# server.js 跟随环境变量,不要在平台上再写死一个不同的值,否则代理端口与监听端口错配。
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# node_modules/.bin 必须在 PATH 上:`prisma db seed` 会 spawn `tsx`(见 prisma.config.ts 的
# migrations.seed),PATH 里没有它就报 `spawn tsx ENOENT` —— 实测 Railway 容器内灌种子失败。
ENV PATH="/app/node_modules/.bin:$PATH"

# 非 root 运行
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# ---- 依赖树:为什么用完整 node_modules 而不是 standalone 的裁剪版 ----
# standalone 的 node_modules **不含 prisma CLI 也不含 .bin**(实测:只有 @prisma/next/react/typescript),
# 而 pnpm 的 node_modules/.bin/prisma 是一个 wrapper 脚本,内部硬编码了
# /app/node_modules/.pnpm/<hash>/... 的绝对路径。
# 因此只复制 node_modules/prisma + @prisma 会让 `prisma migrate deploy` 在容器内必然失败
# (符号链接指向的 .pnpm 子树不存在)。
# 取舍:改为整棵复制构建期的 node_modules(镜像变大约数百 MB),换取迁移可靠可用;
# 先删掉裁剪版再复制,避免"真实目录 vs 符号链接"同名冲突导致的不确定行为。
RUN rm -rf ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# migrate deploy 所需的 schema 与 migrations
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# 本地文件存储目录(FILE_STORAGE_PROVIDER=local 时使用)
RUN mkdir -p /app/.storage && chown -R nextjs:nodejs /app/.storage

# ⚠ 这里**不写 `VOLUME ["/app/.storage"]`** —— Railway 直接拒绝含 VOLUME 的 Dockerfile
# (构建期报 `docker VOLUME at Line N is not supported, use Railway Volumes`),
# 请勿加回来。持久化本来也不靠 VOLUME 声明,而靠部署时真的挂一个**具名**卷:
#   docker run -v ezplm-storage:/app/.storage ...     # 自建主机
#   Railway:Settings → Volumes,挂载点填 /app/.storage
# VOLUME 只会创建匿名卷,容器重建后照样找不回来,等于没保护。

USER nextjs
EXPOSE 3000

# 健康检查:登录页为静态页,不依赖数据库
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000'+(process.env.NEXT_PUBLIC_BASE_PATH||'')+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
