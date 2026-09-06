import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ExcessManifestSchema, GOLDEN_ROOT } from "./manifest";

/**
 * F5:Excess golden —— **如实标注:导入管线尚不存在**。
 *
 * 审计结论(ROUND2_AUDIT §1):ExcessProvider 只有 db/未配置双态,
 * Excel 导入通道没有实现。这里不编一个解析器来"让测试有东西可跑" ——
 * 那正是 KICKOFF 明令禁止的"测试里另算一遍"。
 * 本文件只锁夹具格式(与 ErpExcessLineSchema 对齐,含客户点名的
 * 「最早入库时间」列);管线落地的那个 PR 必须把这里升级为完整对账断言。
 */
const dir = path.join(GOLDEN_ROOT, "excess");
const manifest = ExcessManifestSchema.parse(
  JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8")),
);

describe("Excess golden(格式先行,管线待建)", () => {
  it("manifest 明确标注 PIPELINE_PENDING,不冒充已实现", () => {
    expect(manifest.status).toBe("PIPELINE_PENDING");
    expect(manifest.description).toContain("尚不存在");
  });

  it("夹具列与 ERP 契约对齐(含客户点名的最早入库时间)", () => {
    const header = readFileSync(path.join(dir, manifest.file), "utf-8").split("\n")[0].split(",");
    expect(header).toEqual(manifest.columns);
    expect(manifest.columns).toContain("最早入库时间");
    expect(manifest.columns).toContain("可动用量");
    expect(manifest.columns).toContain("报表单据号");
  });
});
