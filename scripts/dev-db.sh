#!/usr/bin/env bash
# 本地开发 PostgreSQL(Homebrew postgresql@17,项目内数据目录,不注册全局服务)
set -euo pipefail

# macOS + 中文 locale 下 postmaster 会因 CoreFoundation 变多线程而退出,固定 C locale
export LC_ALL=C LANG=C

PG_BIN="$(brew --prefix postgresql@17)/bin"
PGDATA="${EZPLM_PGDATA:-$PWD/.pgdata}"
PORT="${EZPLM_PGPORT:-5433}"
DB_NAME="ezplm_scm_dev"
LOG="$PGDATA/postgres.log"

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null
      echo "initdb 完成: $PGDATA"
    fi
    if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -c listen_addresses=localhost" -l "$LOG" start >/dev/null
    fi
    "$PG_BIN/createdb" -h localhost -p "$PORT" -U postgres "$DB_NAME" 2>/dev/null || true
    echo "dev postgres ready: localhost:$PORT/$DB_NAME"
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PGDATA" stop >/dev/null
    echo "dev postgres stopped"
    ;;
  status)
    "$PG_BIN/pg_ctl" -D "$PGDATA" status
    ;;
  *)
    echo "用法: dev-db.sh start|stop|status" >&2
    exit 1
    ;;
esac
