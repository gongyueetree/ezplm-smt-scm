/**
 * R0-8:零价格守卫。
 * 客户在前期版本上实测撞到的现象是「一行 $0.0000 被计入合计」;
 * 审计发现本仓库同一纪律在四条路径上只接上了一条。这里锁住统一口径。
 */
import { describe, expect, it } from "vitest";
import { checkUsablePrice, hasUsableCost, isUsablePrice } from "@/lib/domain/price-guard";

describe("R0-8 checkUsablePrice", () => {
  it("缺失 ≠ 0:空值一律 EMPTY,原因可读", () => {
    for (const v of [null, undefined, "", "   "]) {
      const r = checkUsablePrice(v);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("EMPTY");
      expect(r.message).toContain("缺失不等于 0");
    }
  });

  it("0 与负数是 NON_POSITIVE,不是「便宜」", () => {
    for (const v of ["0", "0.0000", 0, "-1", -0.5, "0.00"]) {
      const r = checkUsablePrice(v);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("NON_POSITIVE");
    }
    // 原值进消息,便于对账
    expect(checkUsablePrice("0.0000").message).toContain("0.0000");
  });

  it("解析不出有限数值 → UNPARSEABLE,不静默当 0", () => {
    for (const v of ["abc", "N/A", "—", "待报"]) {
      expect(checkUsablePrice(v).reason).toBe("UNPARSEABLE");
    }
  });

  it("正常价格放行,含千分位与货币符号", () => {
    for (const v of ["0.0301", "1234.56", "1,234.56", "$0.12", "¥3.5", 0.0001]) {
      expect(isUsablePrice(v)).toBe(true);
    }
  });

  it("接受任何可 toString 的值(Prisma Decimal 形状)", () => {
    const decimalLike = { toString: () => "0.000000" };
    expect(isUsablePrice(decimalLike)).toBe(false);
    expect(isUsablePrice({ toString: () => "2.5" })).toBe(true);
  });
});

describe("R0-8 hasUsableCost(报价提交门禁)", () => {
  it("存进库的 0.000000 不算「已覆盖成本」", () => {
    expect(hasUsableCost("0.000000")).toBe(false);
    expect(hasUsableCost(null)).toBe(false);
    expect(hasUsableCost("1.25")).toBe(true);
  });
});
