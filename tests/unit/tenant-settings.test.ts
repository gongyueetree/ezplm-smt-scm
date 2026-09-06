import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_SETTINGS,
  resolveTenantSettings,
} from "@/lib/domain/tenant-settings";

/** F1:租户配置合并 —— 一条脏配置不能搞垮整租户,但回落必须留痕 */
describe("TenantSettings 合并", () => {
  it("空存储 → 全默认;所有 flag 默认关,主数据源默认 EZPLM", () => {
    const r = resolveTenantSettings(null);
    expect(r.settings).toEqual(DEFAULT_TENANT_SETTINGS);
    expect(r.settings.featureFlags["customerPortal"]).toBe(false);
    expect(r.settings.masterDataSource).toBe("EZPLM");
    expect(r.settings.erpProvider).toBe("NONE");
    expect(r.invalidKeys).toEqual([]);
  });

  it("部分配置与默认合并", () => {
    const r = resolveTenantSettings({ featureFlags: { customerPortal: true } });
    expect(r.settings.featureFlags.customerPortal).toBe(true);
    expect(r.settings.featureFlags["ecn.impactAnalysis"]).toBe(false);
    expect(r.settings.matchConfidenceThreshold).toBe(0.9);
  });

  it("**坏值回落默认并记录键名**,不静默也不崩", () => {
    const r = resolveTenantSettings({ masterDataSource: "SAP", matchConfidenceThreshold: 0.3 });
    expect(r.settings.masterDataSource).toBe("EZPLM");
    expect(r.settings.matchConfidenceThreshold).toBe(0.9);
    expect(r.invalidKeys).toContain("masterDataSource");
    expect(r.invalidKeys).toContain("matchConfidenceThreshold");
  });

  it("featureFlags 内一个坏键不拖垮其余 flag", () => {
    const r = resolveTenantSettings({
      featureFlags: { customerPortal: true, "ecn.impactAnalysis": "yes" },
    });
    expect(r.settings.featureFlags.customerPortal).toBe(true);
    expect(r.settings.featureFlags["ecn.impactAnalysis"]).toBe(false);
    expect(r.invalidKeys.join()).toContain("featureFlags");
  });

  it("未知键忽略(向前兼容:降级部署读到新键不炸)", () => {
    const r = resolveTenantSettings({ futureKey: 123 });
    expect(r.settings).toEqual(DEFAULT_TENANT_SETTINGS);
  });
});
