import { describe, expect, it } from "vitest";
import { ErpScenarioManifestSchema, loadManifests } from "./manifest";

/**
 * F5:ERP 场景夹具 —— 与 Lab 仓库(gongyueetree/ezplm-erp-lab)
 * `tests/fixtures/erp/<scenario>/manifest.json` **同一格式**。
 * F4 的 IntegrationSyncState 状态机矩阵将消费这些场景;
 * 本测试先锁格式,两仓口径漂移时在这里就红,而不是到 F4 联调才发现。
 */
describe("ERP 场景 manifest(与 Lab 同口径)", () => {
  const all = loadManifests("erp", ErpScenarioManifestSchema);

  it("三个基线场景齐备(normal / missing-fx / network-drop-after-commit)", () => {
    const scenarios = all.map((x) => x.manifest.scenario).sort();
    expect(scenarios).toEqual(["FX_MISSING", "NETWORK_DROP_AFTER_COMMIT", "NORMAL"]);
  });

  it("每个场景都有明确的期望终态 —— F4 状态机矩阵的断言目标", () => {
    for (const { manifest } of all) {
      expect(
        manifest.expected.connection ?? manifest.expected.syncStatus,
        `${manifest.scenario} 缺少期望终态`,
      ).toBeTruthy();
    }
  });
});
