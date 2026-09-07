/**
 * F4:MasterDataProvider 的来源选择纪律。
 *
 * - EZPLM → 返回既有 ezPLM Provider(接口可用);
 * - KINGDEE → **抛 MasterDataNotConfiguredError**(待联调),不静默回落 ezPLM,
 *   不返回空集 —— 换真源必须显式,空集会被读成"没有这颗料";
 * - NONE → 同样抛错(无外部真源)。
 */
import { describe, expect, it } from "vitest";
import {
  MasterDataNotConfiguredError,
  providerForSource,
} from "@/lib/providers/master-data";

describe("providerForSource", () => {
  it("EZPLM:返回可用 Provider(Mock/Http 由 ezPLM 工厂按环境决定)", async () => {
    const p = providerForSource("EZPLM");
    // 接口可调用(Mock 模式下返回数据;不断言具体内容,只断言不抛 NotConfigured)
    await expect(p.searchParts({ keyword: "STM32", limit: 1 })).resolves.toBeDefined();
  });

  it("KINGDEE:调用即抛 MasterDataNotConfiguredError,不回落、不返回空集", async () => {
    const p = providerForSource("KINGDEE");
    await expect(p.searchParts({ keyword: "STM32", limit: 1 })).rejects.toThrow(
      MasterDataNotConfiguredError,
    );
    await expect(p.getPartByMpn({ mpn: "STM32F103C8T6" })).rejects.toThrow(/待客户凭据|不可用/);
  });

  it("NONE:同样抛错 —— 无外部真源不等于查过了没有", async () => {
    const p = providerForSource("NONE");
    await expect(p.batchResolve([])).rejects.toThrow(MasterDataNotConfiguredError);
  });

  it("错误信息说明原因与去向(不是一句『失败』)", async () => {
    const p = providerForSource("KINGDEE");
    await expect(p.getInventory([])).rejects.toThrow(/O1/);
  });
});
