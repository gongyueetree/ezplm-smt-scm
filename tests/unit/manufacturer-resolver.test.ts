/**
 * R4-3(§53):Manufacturer Resolution golden 矩阵(纯函数核心)。
 * 覆盖任务书 18 项:变体归一/别名优先级/租户隔离/MPN 证据/冲突/垃圾值/
 * PCB 分流/PATTERN/raw 保留/canonical ID 为身份。
 */
import { describe, expect, it } from "vitest";
import { manufacturerKeyOf } from "@/lib/domain/part-mfg";
import {
  resolveManufacturer,
  type ResolverContext,
} from "@/lib/integration/erp/normalization/manufacturer-resolver";

const YAGEO = { id: "cmr_yageo", canonicalName: "YAGEO", normalizedName: "YAGEO" };
const TI = { id: "cmr_ti", canonicalName: "Texas Instruments", normalizedName: "TEXASINSTRUMENTS" };
const ST = { id: "cmr_st", canonicalName: "STMicroelectronics", normalizedName: "STMICROELECTRONICS" };
const MURATA = { id: "cmr_murata", canonicalName: "Murata", normalizedName: "MURATA" };

function ctx(overrides: Partial<ResolverContext> = {}): ResolverContext {
  return {
    tenantAliases: new Map(),
    globalAliases: new Map([
      ["TI", { normalizedAlias: "TI", canonicalRefId: TI.id, canonicalName: TI.canonicalName }],
      ["STM", { normalizedAlias: "STM", canonicalRefId: ST.id, canonicalName: ST.canonicalName }],
      ["ST", { normalizedAlias: "ST", canonicalRefId: ST.id, canonicalName: ST.canonicalName }],
    ]),
    canonicalByNorm: new Map([
      [YAGEO.normalizedName, YAGEO],
      [TI.normalizedName, TI],
      [ST.normalizedName, ST],
      [MURATA.normalizedName, MURATA],
    ]),
    ...overrides,
  };
}

const tenantYageoVariant = new Map([
  [manufacturerKeyOf("YAGEO(国巨)"), { normalizedAlias: manufacturerKeyOf("YAGEO(国巨)"), canonicalRefId: YAGEO.id, canonicalName: "YAGEO" }],
  [manufacturerKeyOf("国巨"), { normalizedAlias: manufacturerKeyOf("国巨"), canonicalRefId: YAGEO.id, canonicalName: "YAGEO" }],
]);

describe("§53 制造商解析矩阵", () => {
  it("01 YAGEO / Yageo / YAGEO(国巨) 归到同一 canonical(大小写经键归一;变体经租户别名)", () => {
    const c = ctx({ tenantAliases: tenantYageoVariant });
    for (const raw of ["YAGEO", "Yageo"]) {
      const r = resolveManufacturer({ rawManufacturer: raw }, c);
      expect(r.canonicalManufacturerId, raw).toBe(YAGEO.id);
      expect(r.resolution, raw).toBe("CANONICAL_EXACT");
    }
    const v = resolveManufacturer({ rawManufacturer: "YAGEO(国巨)" }, c);
    expect(v.canonicalManufacturerId).toBe(YAGEO.id);
    expect(v.resolution).toBe("TENANT_ALIAS");
  });

  it("02 租户别名优先于 fuzzy;05 canonical 精确优先于 fuzzy", () => {
    const c = ctx({ tenantAliases: tenantYageoVariant });
    expect(resolveManufacturer({ rawManufacturer: "国巨" }, c).resolution).toBe("TENANT_ALIAS");
    expect(resolveManufacturer({ rawManufacturer: "Murata" }, c).resolution).toBe("CANONICAL_EXACT");
  });

  it("03 全局别名跨租户可用(空租户上下文也命中);04 租户别名不泄漏到其它租户", () => {
    // 租户 A 有 YAGEO(国巨) 别名;租户 B 的上下文没有 —— B 解析同一串不得命中
    const a = ctx({ tenantAliases: tenantYageoVariant });
    const b = ctx(); // 另一租户:无租户别名
    expect(resolveManufacturer({ rawManufacturer: "TI" }, b).resolution).toBe("GLOBAL_ALIAS");
    expect(resolveManufacturer({ rawManufacturer: "YAGEO(国巨)" }, a).canonicalManufacturerId).toBe(YAGEO.id);
    const leaked = resolveManufacturer({ rawManufacturer: "YAGEO(国巨)" }, b);
    expect(leaked.resolution).not.toBe("TENANT_ALIAS");
    expect(["FUZZY_CANDIDATE", "UNRESOLVED"]).toContain(leaked.resolution);
  });

  it("06 唯一 exact MPN 可提议厂商(高置信候选);07 MPN 证据不得静默建永久别名", () => {
    const c = ctx({
      mpnEvidence: (k) => (k === "CC0603KRX7R8BB123" ? { manufacturerName: "YAGEO" } : null),
    });
    const r = resolveManufacturer({ rawManufacturer: "神秘写法", mpn: "CC0603KRX7R8BB123" }, c);
    // "神秘写法" 无别名/标准名命中 → 落到 MPN 证据…但 raw 与 YAGEO 不相容 → 冲突
    expect(r.resolution).toBe("MANUFACTURER_CONFLICT");
    // raw 为空时:纯 MPN 证据 → 候选,requiresManualDecision(不自动落别名)
    const r2 = resolveManufacturer({ rawManufacturer: null, mpn: "CC0603KRX7R8BB123" }, c);
    expect(r2.resolution).toBe("MPN_EVIDENCE");
    expect(r2.confidence).toBeCloseTo(0.98, 2);
    expect(r2.requiresManualDecision).toBe(true);
  });

  it("17 §17:MPN 帮助确认 Manufacturer —— 不规范写法 + 相容 MPN 证据 → 通过证据解析", () => {
    const c = ctx({
      mpnEvidence: (k) => (k === "STM32F103C8T6" ? { manufacturerName: "STMicroelectronics" } : null),
    });
    // "STMicro电子" 无别名命中,但 MPN 证据厂商与其相容(STMICRO 前缀)→ MPN_EVIDENCE
    const r = resolveManufacturer({ rawManufacturer: "STMicro", mpn: "STM32F103C8T6" }, ctx({
      globalAliases: new Map(), // 拿掉 STM 全局别名,逼出 MPN 证据通道
      mpnEvidence: c.mpnEvidence,
    }));
    expect(r.resolution).toBe("MPN_EVIDENCE");
    expect(r.canonicalManufacturerName).toBe("STMicroelectronics");
  });

  it("08 fuzzy 永远只是候选;09 冲突必须人工裁决且不覆盖任何一方", () => {
    const fz = resolveManufacturer({ rawManufacturer: "Murata Electronics" }, ctx());
    expect(fz.resolution).toBe("FUZZY_CANDIDATE");
    expect(fz.requiresManualDecision).toBe(true);
    expect(fz.confidence).toBeLessThanOrEqual(0.7);

    const conflict = resolveManufacturer(
      { rawManufacturer: "Murata", mpn: "ABC123" },
      ctx({ mpnEvidence: () => ({ manufacturerName: "YAGEO" }) }),
    );
    expect(conflict.resolution).toBe("MANUFACTURER_CONFLICT");
    expect(conflict.requiresManualDecision).toBe(true);
    expect(conflict.canonicalManufacturerId).toBeNull(); // 不覆盖任何一方
    expect(conflict.rawManufacturer).toBe("Murata"); // 16 raw 保留
  });

  it("10 未知 MFG 保持 UNRESOLVED;11 #N/NA/0 垃圾值不建厂商", () => {
    expect(resolveManufacturer({ rawManufacturer: "没听说过的厂" }, ctx()).resolution).toBe("UNRESOLVED");
    for (const junk of ["#N", "NA", "0", "-", "无"]) {
      const r = resolveManufacturer({ rawManufacturer: junk }, ctx());
      expect(r.resolution, junk).toBe("UNRESOLVED");
      expect(r.canonicalManufacturerId, junk).toBeNull();
    }
  });

  it("12 PCB 不进元器件制造商解析(板厂 MFG 不映射到元器件厂)", () => {
    const r = resolveManufacturer(
      { rawManufacturer: "深圳某板厂", materialKind: "PCB_BARE_BOARD" },
      ctx(),
    );
    expect(r.resolution).toBe("UNRESOLVED");
    expect(r.evidence[0]).toContain("PCB_BARE_BOARD");
  });

  it("16 归一化后 raw 永久保留;17 身份比较用 canonicalManufacturerId 而非字符串", () => {
    const c = ctx({ tenantAliases: tenantYageoVariant });
    const a = resolveManufacturer({ rawManufacturer: "YAGEO(国巨)" }, c);
    const b = resolveManufacturer({ rawManufacturer: "Yageo" }, c);
    expect(a.rawManufacturer).toBe("YAGEO(国巨)");
    expect(b.rawManufacturer).toBe("Yageo");
    expect(a.canonicalManufacturerId).toBe(b.canonicalManufacturerId); // 同一身份
  });
});
