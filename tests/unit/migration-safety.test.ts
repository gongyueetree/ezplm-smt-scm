import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Migration 安全护栏(PR-D)。
 *
 * 生产库不能被一次迁移搞坏。本项目的硬约束:
 * - **禁止删列 / 删表 / 改列类型** —— 历史数据会失效;
 * - **新增列不得是无默认值的 NOT NULL** —— 已有行填不上,迁移直接失败;
 * - 枚举只能追加值,不能删值。
 *
 * 这些错误只在**对着有数据的生产库执行时**才炸,本地空库跑不出来,
 * 所以必须用测试在提交前挡住。
 */
const DIR = path.join(__dirname, "..", "..", "prisma", "migrations");

function allMigrations(): { name: string; sql: string }[] {
  return readdirSync(DIR)
    .filter((d) => /^\d{8}/.test(d))
    .map((d) => ({
      name: d,
      sql: readFileSync(path.join(DIR, d, "migration.sql"), "utf8"),
    }));
}

/** 去掉注释行,避免注释里的关键词误报 */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("Migration 安全性", () => {
  const migrations = allMigrations();

  it("至少存在若干迁移(防止用例因目录读空而假绿)", () => {
    expect(migrations.length).toBeGreaterThan(5);
  });

  it("**没有任何迁移删除表或列**", () => {
    const offenders: string[] = [];
    for (const m of migrations) {
      for (const st of statements(m.sql)) {
        if (/\bDROP\s+TABLE\b/i.test(st)) offenders.push(`${m.name}: DROP TABLE`);
        if (/\bDROP\s+COLUMN\b/i.test(st)) offenders.push(`${m.name}: DROP COLUMN`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("**没有修改已有列的类型**(会让历史数据失效)", () => {
    const offenders: string[] = [];
    for (const m of migrations) {
      for (const st of statements(m.sql)) {
        if (/ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE/i.test(st)) {
          offenders.push(`${m.name}: ${st.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("**新增列若为 NOT NULL 必须带默认值**,否则已有行填不上、迁移会失败", () => {
    const offenders: string[] = [];
    for (const m of migrations) {
      for (const st of statements(m.sql)) {
        if (!/ADD\s+COLUMN/i.test(st)) continue;
        // 逐个 ADD COLUMN 片段判断
        for (const frag of st.split(/,(?=\s*ADD\s+COLUMN)/i)) {
          if (!/ADD\s+COLUMN/i.test(frag)) continue;
          if (/NOT\s+NULL/i.test(frag) && !/DEFAULT/i.test(frag)) {
            offenders.push(`${m.name}: ${frag.trim().slice(0, 90)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("枚举只追加值,不删值", () => {
    const offenders: string[] = [];
    for (const m of migrations) {
      for (const st of statements(m.sql)) {
        if (/ALTER\s+TYPE/i.test(st) && /DROP\s+VALUE/i.test(st)) {
          offenders.push(`${m.name}: 删除枚举值`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 纯新增语句白名单。逐条说明为什么它对已有数据安全:
   * - CREATE TYPE / TABLE / INDEX:新对象,不碰旧数据
   * - ALTER TYPE ... ADD VALUE:枚举追加值,旧值仍有效
   * - ALTER TABLE ... ADD COLUMN:上面已单独保证「NOT NULL 必带默认值」
   */
  const ADDITIVE = /^(CREATE TYPE|CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TYPE|ALTER TABLE)/i;

  it("PR-D 的迁移确实存在且**全部语句都是纯新增**", () => {
    const prd = migrations.find((m) => m.name.includes("prod_erp_reliability"));
    expect(prd, "应能找到 prod_erp_reliability 迁移").toBeTruthy();
    const sts = statements(prd!.sql);
    expect(sts.length).toBeGreaterThan(0);
    const offenders = sts.filter((st) => !ADDITIVE.test(st));
    expect(offenders).toEqual([]);
  });
});
