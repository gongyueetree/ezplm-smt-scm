/**
 * R4-2:PartMfgMapping 领域守卫。
 * 锁定:PO_HISTORY 永不覆盖 Part.mpn(§22);只有 APPROVED+PRIMARY+人工确认
 * 才可同步 preferred(§23);PATTERN 不可作 preferred;MAINTAINED 默认保守(§21);
 * PCB 不进元器件管线(§28);键规则与迁移 SQL 一致。
 */
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
