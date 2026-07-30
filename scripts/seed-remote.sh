#!/bin/sh
# ============================================================
# 向**远端**数据库灌演示种子(Railway / 云主机)。
#
# 为什么需要这个脚本:
# - 生产镜像是 standalone 产物,**不含应用源码**,容器内跑不了 `prisma db seed`
#   (prisma/seed.ts 依赖 ../lib/*),见 docs/DEPLOYMENT.md;
# - 手拼一条带嵌套 read 与引号的长命令在 shell 里极易出错
#   (实测踩到 `zsh: not an identifier: postgresql:...`)。
#
# 用法:
#   sh scripts/seed-remote.sh              # 交互输入,确认后执行
#   sh scripts/seed-remote.sh --dry-run    # 只校验与显示目标,不写库
#
# 连接串取 Railway → Postgres 服务 → Variables → DATABASE_PUBLIC_URL。
# 输入全程不回显,也不进 shell 历史。
# ============================================================
set -eu

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# 无论怎么退出都要把回显恢复,否则终端会一直看不见输入
restore_echo() { stty echo 2>/dev/null || true; }
trap restore_echo EXIT INT TERM

read_hidden() {
  # $1 = 提示语;结果放进全局 REPLY_HIDDEN
  printf '%s' "$1"
  stty -echo 2>/dev/null || true
  IFS= read -r REPLY_HIDDEN
  restore_echo
  printf '\n'
}

read_hidden '粘贴数据库连接串(Postgres 服务 → Variables → DATABASE_PUBLIC_URL),回车:'
DB_URL="$REPLY_HIDDEN"

case "$DB_URL" in
  postgres://*|postgresql://*) ;;
  '')
    echo "错误:没有输入内容。" >&2
    exit 1 ;;
  *)
    echo "错误:这不像 PostgreSQL 连接串(应以 postgresql:// 或 postgres:// 开头)。" >&2
    echo "      你可能粘错了变量 —— 要的是 DATABASE_PUBLIC_URL 的**值**。" >&2
    exit 1 ;;
esac

case "$DB_URL" in
  *railway.internal*)
    echo "错误:这是 Railway 的**内网**地址(railway.internal),本机连不上。" >&2
    echo "      请改用同一个 Postgres 服务的 DATABASE_PUBLIC_URL" >&2
    echo "      (主机名含 proxy.rlwy.net、端口是五位随机数)。" >&2
    exit 1 ;;
  *localhost*|*127.0.0.1*)
    echo "警告:目标是本机数据库,不是远端。若确实要灌本地库,直接 pnpm db:seed 即可。" >&2
    exit 1 ;;
esac

# 只显示 host:port/dbname,不显示用户名与密码 —— 写库之前让人确认打的是哪个库
TARGET=$(printf '%s' "$DB_URL" | sed -e 's|^[a-z]*://||' -e 's|^[^@]*@||' -e 's|?.*$||')
echo "目标数据库:$TARGET"

read_hidden '设置演示账号口令(公网部署请用强口令,不要用 demo1234),回车:'
SEED_PW="$REPLY_HIDDEN"

if [ -z "$SEED_PW" ]; then
  echo "错误:口令为空。公网可达的部署用缺省口令等于把门敞开,这里不允许留空。" >&2
  exit 1
fi
if [ "$SEED_PW" = "demo1234" ]; then
  echo "错误:demo1234 是仓库里公开的缺省口令,不能用于公网部署。" >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "--dry-run:校验通过,未写入任何数据。"
  exit 0
fi

printf '确认向上面这个库写入演示租户与 5 个演示账号?[y/N] '
read -r CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) echo "已取消。"; exit 0 ;;
esac

# 注意:不覆盖 NODE_ENV —— 种子脚本在 production 下拒绝执行是有意的守卫,
# 不在这里悄悄绕过。本机通常未设 NODE_ENV,守卫自然放行。
DATABASE_URL="$DB_URL" SEED_DEMO_PASSWORD="$SEED_PW" pnpm exec prisma db seed
