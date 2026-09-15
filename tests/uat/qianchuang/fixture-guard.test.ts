/**
 * R4-0:私有 UAT 夹具守卫。
 * - QIANCHUANG_UAT_FIXTURE_DIR 未配置 → **FAIL**(专用命令不许静默变绿);
 * - 配置了 → 断言 6/7 个角色文件在场(MATERIAL_MFG 缺失如实报告为失败项,
 *   因为它是 R4 v2 的核心输入 —— 拿到文件前该断言保持红,提醒数据缺口)。
 * 断言只输出文件角色与数量,不输出任何真实数据行(§4 安全纪律)。
 */
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = process.env.QIANCHUANG_UAT_FIXTURE_DIR;

const ROLE_PATTERNS: [string, RegExp][] = [
  ["MATERIAL_MFG", /MFG维护/],
  ["MATERIAL", /^物料_/],
  ["INVENTORY", /即时库存/],
  ["EXCESS", /EXCESS/i],
  ["SUPPLIER", /^供应商/],
  ["CUSTOMER", /^客户/],
  ["PURCHASE_ORDER", /采购订单/],
];

describe("乾创私有 UAT 夹具", () => {
  it("QIANCHUANG_UAT_FIXTURE_DIR 已配置且目录存在", () => {
    expect(dir, "QIANCHUANG_UAT_FIXTURE_DIR 未配置 —— 私有 UAT 套件禁止在无真实数据时假装通过").toBeTruthy();
    expect(existsSync(dir!), `夹具目录不存在:${dir}`).toBe(true);
  });

  it("7 个角色文件齐备(MATERIAL_MFG 缺失时如实红灯,见 R4_REAL_DATA_AUDIT §3)", () => {
    if (!dir || !existsSync(dir)) return; // 上一条已红,不重复报
    const files = readdirSync(dir).filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"));
    const missing = ROLE_PATTERNS.filter(([, re]) => !files.some((f) => re.test(f))).map(([r]) => r);
    expect(missing, `缺失角色:${missing.join("、")}`).toEqual([]);
  });
});
