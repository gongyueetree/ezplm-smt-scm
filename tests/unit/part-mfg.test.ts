/**
 * R4-2:PartMfgMapping 领域守卫。
 * 锁定:PO_HISTORY 永不覆盖 Part.mpn(§22);只有 APPROVED+PRIMARY+人工确认
 * 才可同步 preferred(§23);PATTERN 不可作 preferred;MAINTAINED 默认保守(§21);
 * PCB 不进元器件管线(§28);键规则与迁移 SQL 一致。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PO_HISTORY_DEFAULTS,
  PO_HISTORY_MAX_CONFIDENCE,
  allowsComponentProviders,
  manufacturerKeyOf,
  materialKindAllowsComponentProviders,
  mfgMaintenanceDefaults,
  mfgPartNoKey,
  whyCannotSyncPreferredMpn,
} from "@/lib/domain/part-mfg";

describe("键规则(与迁移 SQL regexp_replace 完全一致;禁止用于展示)", () => {
  it("upper + 去标点空白,保留字母数字含 CJK(纯 ASCII 规则会把中文厂商剥成空串)", () => {
    expect(mfgPartNoKey("GRM155R71C104KA88D")).toBe("GRM155R71C104KA88D");
    expect(mfgPartNoKey("rc0603fr-07 10kl")).toBe("RC0603FR0710KL");
    expect(manufacturerKeyOf("YAGEO(国巨)")).toBe("YAGEO国巨");
    expect(manufacturerKeyOf("风华高科")).toBe("风华高科");
    expect(manufacturerKeyOf("muRata")).toBe("MURATA");
    expect(manufacturerKeyOf(null)).toBe("");
  });
});

describe("§23 preferred MPN 同步守卫", () => {
  const ok = {
    status: "APPROVED",
    relationType: "PRIMARY",
    source: "MANUAL_APPROVED",
    confirmedById: "u1",
    identifierMatchMode: "EXACT",
  } as const;

  it("APPROVED+PRIMARY+人工确认+EXACT → 放行", () => {
    expect(whyCannotSyncPreferredMpn(ok)).toBeNull();
  });

  it("缺任一条件 → 拒绝并说明", () => {
    expect(whyCannotSyncPreferredMpn({ ...ok, status: "CANDIDATE" })).toMatch(/未 APPROVED/);
    expect(whyCannotSyncPreferredMpn({ ...ok, relationType: "HISTORICAL" })).toMatch(/PRIMARY/);
    expect(whyCannotSyncPreferredMpn({ ...ok, confirmedById: null })).toMatch(/人工确认/);
    expect(whyCannotSyncPreferredMpn({ ...ok, identifierMatchMode: "PATTERN" })).toMatch(/通配/);
  });

  it("§22:PO_HISTORY 证据的固定档位永远够不到同步条件", () => {
    expect(PO_HISTORY_DEFAULTS).toEqual({ source: "PO_HISTORY", relationType: "HISTORICAL", status: "CANDIDATE" });
    expect(
      whyCannotSyncPreferredMpn({
        ...PO_HISTORY_DEFAULTS,
        confirmedById: null,
        identifierMatchMode: "EXACT",
      }),
    ).not.toBeNull();
    expect(PO_HISTORY_MAX_CONFIDENCE).toBeLessThanOrEqual(0.75); // 不达批量确认线
  });
});

describe("§21 MFG 维护单档位", () => {
  it("relationType 恒 MAINTAINED;status 默认保守 CANDIDATE,租户显式配置才 APPROVED", () => {
    expect(mfgMaintenanceDefaults(false)).toEqual({
      source: "ERP_MFG_MAINTENANCE",
      relationType: "MAINTAINED",
      status: "CANDIDATE",
    });
    expect(mfgMaintenanceDefaults(true).status).toBe("APPROVED");
  });
});

describe("§28 元器件/PCB 分流", () => {
  it("只有 COMPONENT_MPN / ELECTRONIC_COMPONENT 允许元器件 Provider", () => {
    expect(allowsComponentProviders("COMPONENT_MPN")).toBe(true);
    expect(allowsComponentProviders("PCB_PART_NO")).toBe(false);
    expect(materialKindAllowsComponentProviders("ELECTRONIC_COMPONENT")).toBe(true);
    expect(materialKindAllowsComponentProviders("PCB_BARE_BOARD")).toBe(false);
    expect(materialKindAllowsComponentProviders("ASSEMBLY")).toBe(false);
  });
});

describe("R0-1 键规则:TS 与迁移 SQL 必须同源", () => {
  /**
   * 这条缺陷之所以能活到生产,是因为 TS 规则与 PG 规则各写一处、谁也不校验谁。
   * 迁移是产物(不是生产源码),可以安全地断言其内容 —— 参照 migration-safety.test.ts 的先例。
   */
  const sqlPath = "prisma/migrations/20260915210329_r4_3_key_recompute/migration.sql";

  it("迁移 SQL 用 [[:alnum:]](UTF-8 下保留 CJK),不是剥 ASCII 的 [^0-9A-Z]", () => {
    const raw = readFileSync(join(process.cwd(), sqlPath), "utf8");
    // 注释里会引用旧规则作为说明,断言只看可执行语句
    const sql = raw
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(sql).toContain("[^[:alnum:]]");
    expect(sql).not.toContain("[^0-9A-Z]");
    // 两列都必须按同一规则重算,否则厂商键与料号键会再次分叉
    expect(sql).toContain('"manufacturerPartNoKey"');
    expect(sql).toContain('"manufacturerKey"');
  });

  it("TS 侧保留 CJK,且与 SQL 语义一致的样本逐一对齐", () => {
    // 形如 PG: regexp_replace(upper(x), '[^[:alnum:]]', '', 'g')
    const pgEquivalent = (v: string) => v.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
    for (const s of [
      "RC0402FR-07-10KL(风华)",
      "风华高科",
      "YAGEO(国巨)",
      "GRM188R71H104KA93D",
      "CL05B104KO5NNNC-TR",
      "村田 GRM155",
      "",
    ]) {
      expect(mfgPartNoKey(s)).toBe(pgEquivalent(s));
    }
    // 关键性质:中文不得被剥成空串(旧 ASCII 规则的致命后果)
    expect(mfgPartNoKey("风华高科")).not.toBe("");
  });
});
