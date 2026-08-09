import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * A-2 结构性护栏。
 *
 * 并发行为的真实验证在 E2E(两个 runSync 并发,恰好一个被挡);
 * 本文件守住**结构不被改回去** —— 这类退化在评审时很难一眼看出:
 * 有人把 create 挪回执行之后、或删掉部分唯一索引,功能测试仍然全绿。
 */
const SCHEMA = readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8");
const MIGRATIONS_DIR = path.join(__dirname, "../../prisma/migrations");
const REPO = readFileSync(
  path.join(__dirname, "../../lib/server/repositories/erp-sync.ts"),
  "utf8",
);

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => /^\d/.test(d))
    .map((d) => {
      try {
        return readFileSync(path.join(MIGRATIONS_DIR, d, "migration.sql"), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

describe("A-2 ERP 作业并发", () => {
  it("**同一 租户+连接+实体 只允许一条 RUNNING** —— 部分唯一索引必须存在", () => {
    const sql = allMigrationSql();
    expect(sql).toContain("ErpSyncJob_one_running_per_scope");
    expect(sql).toMatch(/WHERE\s+"status"\s*=\s*'RUNNING'/i);
  });

  it("建索引**前**必须先修历史冲突 —— 否则存量数据会把生产迁移炸掉", () => {
    const sql = allMigrationSql();
    const fixAt = sql.indexOf("UPDATE \"ErpSyncJob\"");
    const idxAt = sql.indexOf("ErpSyncJob_one_running_per_scope");
    expect(fixAt).toBeGreaterThan(-1);
    expect(fixAt).toBeLessThan(idxAt);
  });

  it("租约字段齐备(缺 leaseExpiresAt 则崩溃后永久卡死)", () => {
    for (const f of ["lockedBy", "lockedAt", "leaseExpiresAt"]) {
      expect(SCHEMA).toContain(f);
    }
  });

  it("**租约必须在调用 Provider 之前获取** —— 之后获取等于没有互斥", () => {
    const lease = REPO.indexOf("acquireSyncLease(session");
    const pull = REPO.indexOf("await pullEntity(");
    expect(lease).toBeGreaterThan(-1);
    expect(pull).toBeGreaterThan(-1);
    expect(lease).toBeLessThan(pull);
  });

  it("**结束时更新租约行而不是新建** —— 新建会留下 RUNNING 幽灵行", () => {
    expect(REPO).toContain("tx.erpSyncJob.update({");
    expect(REPO).toContain("where: { id: lease.jobId }");
  });

  it("Provider 抛错时必须释放租约,否则该连接会被锁死", () => {
    const idx = REPO.indexOf("releaseSyncLease(lease.jobId");
    expect(idx).toBeGreaterThan(-1);
  });

  it("过期租约可被回收 —— 崩溃不应让连接永久不可用", () => {
    expect(REPO).toContain("租约超时被回收");
  });
});
