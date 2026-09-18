/**
 * REF-1a:Canonical Part Identity。
 * 锁的是三条从 altpart-pro 采纳的纪律 + 本仓"未知不猜"。
 */
import { describe, expect, it } from "vitest";
import {
  buildPartIdentity,
  classifyMatch,
  guardIdentityReplacement,
  identityCacheKey,
  normalizeMpnKey,
  splitOrderableSuffix,
} from "@/modules/parts/domain/part-identity";

describe("normalizeMpnKey:与库内存量、迁移 SQL 同规则", () => {
  it("大写 + 只留字母数字,**中文必须保留**", () => {
    expect(normalizeMpnKey("rc0603fr-07 10kl")).toBe("RC0603FR0710KL");
    expect(normalizeMpnKey("RC0402FR-07-10KL(风华)")).toBe("RC0402FR0710KL风华");
    expect(normalizeMpnKey("风华高科")).toBe("风华高科");
  });

  it("空值给空串,不抛", () => {
    expect(normalizeMpnKey(null)).toBe("");
    expect(normalizeMpnKey(undefined)).toBe("");
    expect(normalizeMpnKey("  ")).toBe("");
  });
});

describe("splitOrderableSuffix:能证明才拆,拆不出就是 null", () => {
  it("卷带/分销商后缀可拆", () => {
    expect(splitOrderableSuffix("AD8331ARQ-REEL7")).toEqual({
      baseDevice: "AD8331ARQ",
      orderableSuffix: "REEL7",
    });
    expect(splitOrderableSuffix("CL05B104KO5NNNC-TR")).toMatchObject({ orderableSuffix: "TR" });
    expect(splitOrderableSuffix("VCA2615Y/2K5")).toMatchObject({
      baseDevice: "VCA2615Y",
      orderableSuffix: "2K5",
    });
  });

  it("**认不出后缀就不拆** —— baseDevice 为 null 表示「我没拆出来」", () => {
    expect(splitOrderableSuffix("STM32F103C8T6")).toEqual({
      baseDevice: null,
      orderableSuffix: null,
    });
    expect(splitOrderableSuffix("GRM188R71H104KA93D")).toEqual({
      baseDevice: null,
      orderableSuffix: null,
    });
  });

  it("**不猜封装/等级后缀** —— TPS62160DGKR 不得被剥成 TPS62160", () => {
    // altpart-pro 会这么剥;那需要逐厂商编号规则,猜错会把不同封装的器件合并
    expect(splitOrderableSuffix("TPS62160DGKR").baseDevice).toBeNull();
  });

  it("剥完只剩残渣时宁可不拆", () => {
    expect(splitOrderableSuffix("TR")).toEqual({ baseDevice: null, orderableSuffix: null });
    expect(splitOrderableSuffix("A-TR")).toEqual({ baseDevice: null, orderableSuffix: null });
  });

  it("空输入安全", () => {
    expect(splitOrderableSuffix(null)).toEqual({ baseDevice: null, orderableSuffix: null });
  });
});

describe("buildPartIdentity:requested 永不被改写", () => {
  it("原始串原样保留,归一键另存", () => {
    const id = buildPartIdentity({ requestedMpn: " rc0603fr-07 10kl ", source: "LOCAL" });
    expect(id.requestedMpn).toBe("rc0603fr-07 10kl");
    expect(id.normalizedMpn).toBe("RC0603FR0710KL");
  });

  it("**非 EXACT 时 exactMpn 必须为 null** —— 模糊结果不得顶替用户输入", () => {
    for (const mt of ["FUZZY", "BASE_DEVICE", "ORDERABLE_VARIANT", "PACKAGE_VARIANT", "UNVERIFIED"] as const) {
      const id = buildPartIdentity({
        requestedMpn: "TL431",
        exactMpn: "TL431-1", // 就算调用方传了,也不许落进 exactMpn
        matchType: mt,
        source: "EZPLM",
      });
      expect(id.exactMpn, `matchType=${mt}`).toBeNull();
      expect(id.requestedMpn).toBe("TL431");
    }
  });

  it("EXACT 才填 exactMpn;没给就回落到 requested", () => {
    expect(buildPartIdentity({ requestedMpn: "TL431", matchType: "EXACT", source: "EZPLM" }).exactMpn).toBe("TL431");
    expect(
      buildPartIdentity({ requestedMpn: "TL431", exactMpn: "TL431ACDR", matchType: "EXACT", source: "EZPLM" })
        .exactMpn,
    ).toBe("TL431ACDR");
  });

  it("缺省档位是 UNVERIFIED —— 没证实就不算证实", () => {
    expect(buildPartIdentity({ requestedMpn: "X1234", source: "LOCAL" }).matchType).toBe("UNVERIFIED");
  });

  it("三层身份各自独立,互不覆盖(内部料号 ≠ MPN ≠ 客户料号)", () => {
    const id = buildPartIdentity({
      requestedMpn: "GRM188R71H104KA93D",
      internalPn: "10-01-0001",
      customerPn: "CUST-C-001",
      source: "ERP",
    });
    expect(id.internalPn).toBe("10-01-0001");
    expect(id.customerPn).toBe("CUST-C-001");
    expect(id.requestedMpn).toBe("GRM188R71H104KA93D");
  });
});

describe("classifyMatch", () => {
  const req = (mpn: string, pkg?: string) => ({ mpn, canonicalPackage: pkg ?? null });

  it("归一后相同 → EXACT(大小写与分隔符不影响)", () => {
    expect(classifyMatch(req("RC0603FR-0710KL"), { mpn: "rc0603fr 0710kl" })).toBe("EXACT");
  });

  it("只差订货后缀 → ORDERABLE_VARIANT", () => {
    expect(classifyMatch(req("AD8331ARQ"), { mpn: "AD8331ARQ-REEL7" })).toBe("ORDERABLE_VARIANT");
  });

  it("同基础器件但封装不同 → PACKAGE_VARIANT", () => {
    expect(
      classifyMatch(req("AD8331ARQ", "SOIC-8"), { mpn: "AD8331ARQ-TR", canonicalPackage: "TSSOP-8" }),
    ).toBe("PACKAGE_VARIANT");
  });

  it("判不出同源 → FUZZY,**不往上凑**", () => {
    expect(classifyMatch(req("TL431"), { mpn: "TL431-1" })).toBe("FUZZY");
    expect(classifyMatch(req("STM32F103C8T6"), { mpn: "STM32F103C6T6" })).toBe("FUZZY");
  });

  it("没有候选 / 候选无型号 → UNVERIFIED", () => {
    expect(classifyMatch(req("TL431"), null)).toBe("UNVERIFIED");
    expect(classifyMatch(req("TL431"), { mpn: "" })).toBe("UNVERIFIED");
    expect(classifyMatch(req(""), { mpn: "TL431" })).toBe("UNVERIFIED");
  });
});

describe("guardIdentityReplacement:只有 EXACT 可以顶替", () => {
  it("EXACT 放行", () => {
    expect(guardIdentityReplacement("EXACT")).toMatchObject({ allowed: true, requiresConfirmation: false });
  });

  it("其余一律要人工确认,并说明档位", () => {
    for (const mt of ["ORDERABLE_VARIANT", "PACKAGE_VARIANT", "BASE_DEVICE", "FUZZY", "UNVERIFIED"] as const) {
      const g = guardIdentityReplacement(mt);
      expect(g.allowed).toBe(false);
      expect(g.requiresConfirmation).toBe(true);
      expect(g.reason).toContain(mt);
    }
  });
});

describe("identityCacheKey:三维缺一不可", () => {
  it("厂商不同 → 键不同(少了这维会互相覆盖)", () => {
    const a = identityCacheKey("offers", { normalizedMpn: "LM358", canonicalManufacturer: "TI" });
    const b = identityCacheKey("offers", { normalizedMpn: "LM358", canonicalManufacturer: "ONSEMI" });
    expect(a).not.toBe(b);
  });

  it("封装不同 → 键不同", () => {
    const a = identityCacheKey("p", { normalizedMpn: "LM358", canonicalPackage: "SOIC-8" });
    const b = identityCacheKey("p", { normalizedMpn: "LM358", canonicalPackage: "TSSOP-8" });
    expect(a).not.toBe(b);
  });

  it("缺维度用 ANY 占位,不塌缩成同一个键", () => {
    expect(identityCacheKey("p", { normalizedMpn: "LM358" })).toBe("p:lm358:any:any");
  });

  it("**厂商必须由调用方先标准化** —— 本函数不替它做,避免出现第二套厂商归一", () => {
    // 传入未标准化的两种写法会得到不同键,这是**有意**的信号:调用方漏了标准化
    const a = identityCacheKey("p", { normalizedMpn: "LM358", canonicalManufacturer: "TI" });
    const b = identityCacheKey("p", { normalizedMpn: "LM358", canonicalManufacturer: "Texas Instruments" });
    expect(a).not.toBe(b);
  });
});
