#!/bin/sh
# 容器启动:先应用数据库迁移,再拉起应用。
# 使用 migrate deploy(只应用已生成的 migration,绝不在生产改 schema)。
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] 致命错误:DATABASE_URL 未配置" >&2
  exit 1
fi

if [ "$SKIP_MIGRATIONS" = "1" ]; then
  echo "[entrypoint] SKIP_MIGRATIONS=1,跳过数据库迁移"
else
  if [ ! -x ./node_modules/.bin/prisma ]; then
    echo "[entrypoint] 致命错误:找不到 prisma CLI(./node_modules/.bin/prisma)。" >&2
    echo "[entrypoint] 镜像构建可能未复制完整依赖树;或设 SKIP_MIGRATIONS=1 由外部流程执行迁移。" >&2
    exit 1
  fi
  echo "[entrypoint] 应用数据库迁移(prisma migrate deploy)…"
  if ! ./node_modules/.bin/prisma migrate deploy; then
    echo "[entrypoint] 致命错误:数据库迁移失败,拒绝以未迁移的库启动应用。" >&2
    exit 1
  fi
fi

echo "[entrypoint] 启动应用:$*"
exec "$@"
