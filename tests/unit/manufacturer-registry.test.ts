/**
 * REF-1a:统一 Manufacturer Registry。
 * 要点是**一套键规则**,以及"未收录只清洗不猜"。
 */
import { describe, expect, it } from "vitest";
import {
  manufacturerAliasList,
  manufacturerKey,
  MANUFACTURER_RESOLUTION_ORDER,
  normalizeManufacturerName,
  resolveManufacturer,
  sameManufacturer,
} from "@/modules/parts/domain/manufacturer-registry";

describe("normalizeManufacturerName:展示用,保留空格", () => {
  it("大写 + 剥公司后缀 + 压缩空白", () => {
    expect(normalizeManufacturerName("Murata Manufacturing Co., Ltd.")).toBe("MURATA MANUFACTURING");
    expect(normalizeManufacturerName("Texas Instruments Inc")).toBe("TEXAS INSTRUMENTS");
    expect(normalizeManufacturerName("Vishay Intertechnology, Inc.")).toBe("VISHAY INTERTECHNOLOGY");
  });

  it("中文厂商名原样保留", () => {
    expect(normalizeManufacturerName("风华高科")).toBe("风华高科");
    expect(normalizeManufacturerName("YAGEO(国巨)")).toBe("YAGEO(国巨)");
  });

  it("空值安全", () => {
    expect(normalizeManufacturerName(null)).toBe("");
    expect(normalizeManufacturerName("   ")).toBe("");
  });
});

describe("manufacturerKey:**唯一**的键规则", () => {
  it("在展示归一基础上剥掉所有非字母数字,中文保留", () => {
    expect(manufacturerKey("Murata Manufacturing Co., Ltd.")).toBe("MURATAMANUFACTURING");
    expect(manufacturerKey("YAGEO(国巨)")).toBe("YAGEO国巨");
    expect(manufacturerKey("风华高科")).toBe("风华高科");
  });

  it("与 MPN 键同一套字符规则 —— 不同规则正是 R0-1 的成因", () => {
    // 两者都用 [^\p{L}\p{N}];中文都不会被剥空
    expect(manufacturerKey("风华")).not.toBe("");
  });

  it("公司后缀不影响键:三种写法归一到同一个键", () => {
    const k = manufacturerKey("Murata");
    expect(manufacturerKey("Murata Co Ltd")).toBe(k);
    expect(manufacturerKey("MURATA, INC.")).toBe(k);
  });
});

describe("manufacturerAliasList:合并厂商串拆分", () => {
  it("按 / & | + 拆", () => {
    expect(manufacturerAliasList("Microchip / Microsemi")).toEqual(["MICROCHIP", "MICROSEMI"]);
    expect(manufacturerAliasList("AVX & Kyocera")).toEqual(["AVX", "KYOCERA"]);
  });

  it("空值给空数组", () => {
    expect(manufacturerAliasList(null)).toEqual([]);
  });
});

describe("resolveManufacturer:六级顺序的纯函数部分", () => {
  const canonical = new Map([["TEXASINSTRUMENTS", { id: "cmr_ti", name: "Texas Instruments" }]]);
  const globalAlias = new Map([["TI", { id: "cmr_ti", name: "Texas Instruments" }]]);
  const tenantAlias = new Map([["TI", { id: "cmr_ti_tenant", name: "TI(租户口径)" }]]);

  it("解析顺序固定,不得重排", () => {
    expect([...MANUFACTURER_RESOLUTION_ORDER]).toEqual([
      "TENANT_ALIAS",
      "GLOBAL_ALIAS",
      "CANONICAL_EXACT",
      "CLEANED_ONLY",
      "UNRESOLVED",
    ]);
  });

  it("**租户别名优先于全局别名** —— 那是人工确认过的口径", () => {
    const r = resolveManufacturer("TI", { tenantAlias, globalAlias, canonical });
    expect(r.kind).toBe("TENANT_ALIAS");
    expect(r.canonicalId).toBe("cmr_ti_tenant");
  });

  it("无租户别名时落到全局别名", () => {
    expect(resolveManufacturer("TI", { globalAlias, canonical }).kind).toBe("GLOBAL_ALIAS");
  });

  it("标准名精确命中(公司后缀不影响)", () => {
    const r = resolveManufacturer("Texas Instruments Inc.", { canonical });
    expect(r.kind).toBe("CANONICAL_EXACT");
    expect(r.canonicalName).toBe("Texas Instruments");
  });

  it("**未收录只清洗不猜**:给 CLEANED_ONLY + 进评审队列,但不阻塞流程", () => {
    const r = resolveManufacturer("某某电子科技", { canonical });
    expect(r.kind).toBe("CLEANED_ONLY");
    expect(r.canonicalId).toBeNull();
    expect(r.cleanedName).toBe("某某电子科技");
    expect(r.requiresManualDecision).toBe(true);
  });

  it("占位/垃圾值 → UNRESOLVED,且**不进评审队列**(那不是厂商)", () => {
    for (const junk of ["", "  ", "#N/A", "N/A", "NA", "-", "—", "无", "/", "0", "待定", "TBD"]) {
      const r = resolveManufacturer(junk, { canonical });
      expect(r.kind, junk).toBe("UNRESOLVED");
      expect(r.requiresManualDecision, junk).toBe(false);
    }
  });

  it("未收录时仍给出键,便于登记为待评审", () => {
    expect(resolveManufacturer("某某电子").key).toBe("某某电子");
  });
});

describe("sameManufacturer", () => {
  it("公司后缀与大小写不影响判同", () => {
    expect(sameManufacturer("Murata Co., Ltd.", "MURATA")).toBe(true);
  });

  it("合并厂商串任一命中即同", () => {
    expect(sameManufacturer("Microchip / Microsemi", "Microsemi")).toBe(true);
  });

  it("**空不当通配** —— 一侧为空一律不同", () => {
    expect(sameManufacturer(null, "TI")).toBe(false);
    expect(sameManufacturer("", "")).toBe(false);
  });

  it("不同厂商不误判", () => {
    expect(sameManufacturer("Murata", "Yageo")).toBe(false);
  });
});
