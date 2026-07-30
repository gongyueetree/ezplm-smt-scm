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

# ---- 重复粘贴检测 ----
# 输入不回显 → 多按一次 Cmd-V 是**看不见**的,两串会首尾相接,
# 库名变成 `railwaypostgresql://postgres:<密码>@...`。实测踩过,且畸形串一旦被回显
# 就等于把密码打到屏幕/日志里,所以这里必须在任何输出之前先拦掉。
SCHEME_COUNT=$(printf '%s' "$DB_URL" | grep -o '://' | wc -l | tr -d ' ')
AT_COUNT=$(printf '%s' "$DB_URL" | grep -o '@' | wc -l | tr -d ' ')
if [ "$SCHEME_COUNT" != "1" ] || [ "$AT_COUNT" != "1" ]; then
  echo "错误:连接串里出现了多段(检测到 $SCHEME_COUNT 个 '://'、$AT_COUNT 个 '@')。" >&2
  echo "      几乎一定是**重复粘贴** —— 输入不回显,多按一次粘贴是看不见的。" >&2
  echo "      重新运行,只粘一次;粘完直接回车,不要再按任何键。" >&2
  echo "      (为避免泄露,这里不回显你输入的内容。)" >&2
  exit 1
fi

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

# 只显示 host:port/dbname,不显示用户名与密码 —— 写库之前让人确认打的是哪个库。
# 用 ##*@ 从**最后一个** @ 之后取,任何残留的 user:pass 段都不会被回显。
TARGET=${DB_URL##*@}
TARGET=${TARGET%%\?*}
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

# ---- 预检:先确认连得上、迁移已应用 ----
# 直接跑 seed 时 Prisma 抛的是一大坨嵌套对象,真正的原因被埋在几十行里;
# migrate status 会给出 P1001/P1000 这类明确错误码,把失败翻译成能照着做的提示。
echo "预检:连接与迁移状态…"
PRE_OUT=$(DATABASE_URL="$DB_URL" pnpm exec prisma migrate status 2>&1) || true

case "$PRE_OUT" in
  *P1001*)
    echo "连不上数据库(P1001)。逐项检查:" >&2
    echo "  1. 用的是 Postgres 服务的 DATABASE_PUBLIC_URL 吗?(主机名含 proxy.rlwy.net)" >&2
    echo "  2. Postgres 服务 → Settings → Networking → TCP Proxy 启用了吗?" >&2
    echo "  3. 连接串是否被换行/空格截断?整行复制,不要手打" >&2
    exit 1 ;;
  *P1000*)
    echo "认证失败(P1000):用户名或密码不对。" >&2
    echo "  Railway 重建过数据库或轮换过密码时,旧连接串会失效 —— 重新复制一次。" >&2
    exit 1 ;;
  *P1003*)
    echo "目标数据库不存在(P1003):连接串末尾的库名对不上。" >&2
    exit 1 ;;
  *certificate*|*SSL*|*ssl*|*TLS*)
    echo "SSL/TLS 相关错误。在连接串末尾加 ?sslmode=require 再试:" >&2
    echo "  ...proxy.rlwy.net:41234/railway?sslmode=require" >&2
    exit 1 ;;
esac

if printf '%s' "$PRE_OUT" | grep -q "have not yet been applied"; then
  echo "库里还有未应用的迁移 —— 先让容器启动一次(entrypoint 会跑 migrate deploy)," >&2
  echo "或手动执行 DATABASE_URL=<公网串> pnpm db:deploy,再回来灌种子。" >&2
  exit 1
fi

if ! printf '%s' "$PRE_OUT" | grep -q "Database schema is up to date"; then
  echo "预检没有得到预期结果,原始输出如下(已脱敏):" >&2
  # Prisma 一般只打 host:port,但万一带了整串,这里把 scheme://user:pass@ 抹掉
  printf '%s\n' "$PRE_OUT" | sed -e 's|[a-z]*://[^@ ]*@|***@|g' >&2
  exit 1
fi
echo "预检通过:连接正常,迁移已全部应用。"

printf '确认向上面这个库写入演示租户与 5 个演示账号?[y/N] '
read -r CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) echo "已取消。"; exit 0 ;;
esac

# 注意:不覆盖 NODE_ENV —— 种子脚本在 production 下拒绝执行是有意的守卫,
# 不在这里悄悄绕过。本机通常未设 NODE_ENV,守卫自然放行。
DATABASE_URL="$DB_URL" SEED_DEMO_PASSWORD="$SEED_PW" pnpm exec prisma db seed
