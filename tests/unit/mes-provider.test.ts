import { describe, expect, it } from "vitest";
import {
  MesNotConfiguredError,
  getMesTraceProvider,
  traceGranularityNote,
} from "@/lib/providers/mes";

/**
 * E6 / 客户 Q12:「最好 SN 级别,但 SN 需要和 MES 关联」。
 *
 * 守一条:**没有 MES 就不许声称 SN 级可用**,也不许返回空数组冒充"查过了没数据"。
 */
describe("MES Provider", () => {
  it("默认未配置", () => {
    const p = getMesTraceProvider();
    expect(p.state).toBe("NOT_CONFIGURED");
    expect(p.vendor).toBeNull();
  });

  it("**未配置时抛错,不返回空数组** —— 空数组会被读成「查过了,没有 SN」", async () => {
    await expect(getMesTraceProvider().pullSerials({})).rejects.toBeInstanceOf(MesNotConfiguredError);
  });

  it("错误信息说清为什么做不了,以及需要客户提供什么", async () => {
    let msg = "";
    try {
      await getMesTraceProvider().pullSerials({});
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("本系统不产生 SN");
    expect(msg).toContain("MES");
  });

  it("**没有 MES 时,粒度文案一律是批次级**,且如实说明是客户决定暂不接入", () => {
    /*
     * 客户第三轮答复(2026-08):MES「暂时不用」。
     * 措辞从「待接入」改为「暂不接入」—— 前者暗示在等日期,后者如实说明
     * 这是客户的决定。断言随口径更新,守的仍是同一条:不夸大追溯能力。
     */
    const note = traceGranularityNote("NOT_CONFIGURED", 0);
    expect(note).toContain("批次级");
    expect(note).toContain("暂不接入");
    expect(note).toContain("2026-08");
    expect(note).not.toContain("SN 级追溯已");
  });

  it("即使离线导入了 SN,未接 MES 也只说「可由 SN 反查」,不说粒度已是 SN 级", () => {
    const note = traceGranularityNote("NOT_CONFIGURED", 120);
    expect(note).toContain("批次级");
    expect(note).toContain("120 条 SN");
    expect(note).toContain("暂不接入");
  });

  it("只有真的接上 MES 才说 SN 级", () => {
    expect(traceGranularityNote("CONFIGURED", 120)).toContain("SN 级");
  });
});
