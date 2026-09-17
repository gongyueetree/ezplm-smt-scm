/**
 * REF-0.8:迁移期 feature flag。
 * 最要紧的一条:**认不出就是关**。"看不懂当开着"会让一台机器悄悄跑着新实现。
 */
import { describe, expect, it } from "vitest";
import {
  isRefactorFlag,
  isRefactorFlagOn,
  refactorFlagEnvName,
  refactorFlagState,
  refactorFlagStatus,
  REFACTOR_FLAGS,
} from "@/lib/domain/refactor-flags";

describe("REF-0.8 迁移期 flag", () => {
  it("四个 flag 与 MIGRATION_PLAN 的 REF-1..REF-4 一一对应", () => {
    expect([...REFACTOR_FLAGS]).toEqual([
      "PART_IDENTITY_V2",
      "BOM_NORMALIZER_V2",
      "SUPPLIER_MAPPING_V2",
      "ALTERNATE_ENGINE_V2",
    ]);
  });

  it("环境变量名统一加 REFACTOR_ 前缀,不与业务配置混淆", () => {
    expect(refactorFlagEnvName("BOM_NORMALIZER_V2")).toBe("REFACTOR_BOM_NORMALIZER_V2");
  });

  it("**默认全关**:未设置即 DEFAULT_OFF", () => {
    for (const f of REFACTOR_FLAGS) {
      const s = refactorFlagState(f, {});
      expect(s.on).toBe(false);
      expect(s.source).toBe("DEFAULT_OFF");
    }
  });

  it("只认明确真值,大小写与空白不敏感", () => {
    for (const v of ["1", "true", "TRUE", "on", "Yes", "  true  "]) {
      expect(isRefactorFlagOn("BOM_NORMALIZER_V2", { REFACTOR_BOM_NORMALIZER_V2: v })).toBe(true);
    }
  });

  it("明确假值判 ENV_OFF", () => {
    for (const v of ["0", "false", "off", "no", ""]) {
      const s = refactorFlagState("BOM_NORMALIZER_V2", { REFACTOR_BOM_NORMALIZER_V2: v });
      expect(s.on).toBe(false);
      expect(s.source).toBe("ENV_OFF");
    }
  });

  it("**认不出的值一律当关**,但标 UNRECOGNIZED_OFF 且留原值 —— 拼错的开关不该和没设一样", () => {
    const s = refactorFlagState("BOM_NORMALIZER_V2", { REFACTOR_BOM_NORMALIZER_V2: "ture" });
    expect(s.on).toBe(false);
    expect(s.source).toBe("UNRECOGNIZED_OFF");
    expect(s.rawValue).toBe("ture");
  });

  it("超长原值被截断,避免把奇怪的东西整坨带进诊断输出", () => {
    const s = refactorFlagState("BOM_NORMALIZER_V2", {
      REFACTOR_BOM_NORMALIZER_V2: "x".repeat(200),
    });
    expect(s.rawValue!.length).toBeLessThanOrEqual(40);
  });

  it("一个 flag 打开不影响其余三个", () => {
    const env = { REFACTOR_BOM_NORMALIZER_V2: "1" };
    const on = refactorFlagStatus(env).filter((s) => s.on).map((s) => s.flag);
    expect(on).toEqual(["BOM_NORMALIZER_V2"]);
  });

  it("isRefactorFlag 守住取值域", () => {
    expect(isRefactorFlag("BOM_NORMALIZER_V2")).toBe(true);
    expect(isRefactorFlag("SOMETHING_ELSE")).toBe(false);
  });

  it("状态可解释:每个 flag 都给出 on + source(便于回答「这台机器为什么跑新实现」)", () => {
    const st = refactorFlagStatus({ REFACTOR_ALTERNATE_ENGINE_V2: "yes" });
    expect(st).toHaveLength(REFACTOR_FLAGS.length);
    expect(st.find((s) => s.flag === "ALTERNATE_ENGINE_V2")).toMatchObject({
      on: true,
      source: "ENV_ON",
    });
  });
});
