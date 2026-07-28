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
  echo "[entrypoint] 应用数据库迁移(prisma migrate deploy)…"
  ./node_modules/.bin/prisma migrate deploy
fi

echo "[entrypoint] 启动应用:$*"
exec "$@"
