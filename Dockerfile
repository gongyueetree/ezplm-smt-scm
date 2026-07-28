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
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非 root 运行
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# standalone 产物已包含裁剪后的 node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# migrate deploy 所需(schema、migrations 与 prisma CLI)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin ./node_modules/.bin
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# 本地文件存储目录(FILE_STORAGE_PROVIDER=local 时使用;生产建议挂卷或改用对象存储)
RUN mkdir -p /app/.storage && chown -R nextjs:nodejs /app/.storage
VOLUME ["/app/.storage"]

USER nextjs
EXPOSE 3000

# 健康检查:登录页为静态页,不依赖数据库
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000'+(process.env.NEXT_PUBLIC_BASE_PATH||'')+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
