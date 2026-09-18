/**
 * REF-1a:统一 Manufacturer Registry。
 * 要点是**一套键规则**,以及"未收录只清洗不猜"。
 */
import { describe, expect, it } from "vitest";
import {
  manufacturerAliasList,
  manufacturerFuzzyForm,
  manufacturerKey,
  MANUFACTURER_RESOLUTION_ORDER,
  resolveManufacturer,
  sameManufacturer,
} from "@/modules/parts/domain/manufacturer-registry";

describe("manufacturerFuzzyForm:**模糊/展示形态,不是键**", () => {
  it("大写 + 剥公司后缀 + 压缩空白", () => {
    expect(manufacturerFuzzyForm("Murata Manufacturing Co., Ltd.")).toBe("MURATA MANUFACTURING");
    expect(manufacturerFuzzyForm("Texas Instruments Inc")).toBe("TEXAS INSTRUMENTS");
    expect(manufacturerFuzzyForm("Vishay Intertechnology, Inc.")).toBe("VISHAY INTERTECHNOLOGY");
  });

  it("中文厂商名原样保留", () => {
    expect(manufacturerFuzzyForm("风华高科")).toBe("风华高科");
    expect(manufacturerFuzzyForm("YAGEO(国巨)")).toBe("YAGEO(国巨)");
  });

  it("空值安全", () => {
    expect(manufacturerFuzzyForm(null)).toBe("");
    expect(manufacturerFuzzyForm("   ")).toBe("");
  });
});

describe("manufacturerKey:**唯一**的键规则", () => {
  it("大写 + 只留字母数字,中文保留", () => {
    expect(manufacturerKey("YAGEO(国巨)")).toBe("YAGEO国巨");
    expect(manufacturerKey("风华高科")).toBe("风华高科");
    expect(manufacturerKey("Murata Manufacturing Co., Ltd.")).toBe("MURATAMANUFACTURINGCOLTD");
  });

  it("与 MPN 键同一套字符规则 —— 不同规则正是 R0-1 的成因", () => {
    expect(manufacturerKey("风华")).not.toBe("");
  });

  it("**公司后缀刻意保留在键里** —— 剥后缀是身份合并,那是人的决定不是归一的", () => {
    // 这条与直觉相反,但是有意的(REF-1c 决策):
    // ① 它与库内存量一致 → 采纳零迁移;
    // ② 剥后缀在真实数据上会新增 65 组撞键 / 246 个原值,那是静默的身份合并;
    // ③ 带词边界的规则做不到 TS ≡ 迁移 SQL 的可证等价(\b 与 \y 在 CJK 相邻时不同)。
    // 想要更高自动解析率,正确做法是**扩充别名表**(人工批准、可审计、可回滚)。
    expect(manufacturerKey("Murata Co Ltd")).not.toBe(manufacturerKey("Murata"));
    // 而模糊形态**会**把它们归一到一起 —— 用于候选与冲突检测,不用于查表
    expect(manufacturerFuzzyForm("Murata Co Ltd")).toBe(manufacturerFuzzyForm("Murata"));
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

  it("标准名精确命中", () => {
    const r = resolveManufacturer("Texas Instruments", { canonical });
    expect(r.kind).toBe("CANONICAL_EXACT");
    expect(r.canonicalName).toBe("Texas Instruments");
  });

  it("**带公司后缀的写法不自动命中** —— 走评审队列建别名,而不是靠放宽键规则蒙对", () => {
    const r = resolveManufacturer("Texas Instruments Inc.", { canonical });
    expect(r.kind).toBe("CLEANED_ONLY");
    expect(r.requiresManualDecision).toBe(true);
    // 人工批准一条别名后即可命中 —— 可审计、可回滚
    const withAlias = resolveManufacturer("Texas Instruments Inc.", {
      canonical,
      tenantAlias: new Map([[manufacturerKey("Texas Instruments Inc."), { id: "cmr_ti", name: "Texas Instruments" }]]),
    });
    expect(withAlias.kind).toBe("TENANT_ALIAS");
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
