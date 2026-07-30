import { describe, expect, it } from "vitest";
import { bucketOf, computeAging, overdueDays } from "@/lib/domain/recon-aging";

const ASOF = "2026-07-29";

describe("账龄分桶", () => {
  it("未到期不是账龄 0,单列一档", () => {
    expect(bucketOf("2026-08-30", ASOF)).toBe("未到期");
    expect(bucketOf(ASOF, ASOF)).toBe("未到期");
  });

  it("按逾期天数分桶", () => {
    expect(bucketOf("2026-07-01", ASOF)).toBe("0-30");
    expect(bucketOf("2026-06-01", ASOF)).toBe("31-60");
    expect(bucketOf("2026-05-15", ASOF)).toBe("61-90");
    expect(bucketOf("2025-01-01", ASOF)).toBe("90+");
  });

  it("**到期日未知单列,绝不并入 0-30**", () => {
    expect(bucketOf(null, ASOF)).toBe("到期日未知");
    expect(bucketOf("不是日期", ASOF)).toBe("到期日未知");
  });

  it("overdueDays:未到期为负,未知为 null", () => {
    expect(overdueDays("2026-07-01", ASOF)).toBe(28);
    expect(overdueDays("2026-08-30", ASOF)).toBeLessThan(0);
    expect(overdueDays(null, ASOF)).toBeNull();
  });
});

describe("computeAging", () => {
  it("分桶合计与总额", () => {
    const r = computeAging(
      [
        { amount: "100", dueDate: "2026-08-30" },
        { amount: "200", dueDate: "2026-07-01" },
        { amount: "300", dueDate: "2026-06-01" },
        { amount: "400", dueDate: "2025-01-01" },
        { amount: "500", dueDate: null },
      ],
      ASOF,
    );
    expect(r.total).toBe("1500");
    const byBucket = Object.fromEntries(r.buckets.map((b) => [b.bucket, b.amount]));
    expect(byBucket["未到期"]).toBe("100");
    expect(byBucket["0-30"]).toBe("200");
    expect(byBucket["31-60"]).toBe("300");
    expect(byBucket["90+"]).toBe("400");
    expect(byBucket["到期日未知"]).toBe("500");
    // 逾期合计不含未到期与未知
    expect(r.overdueTotal).toBe("900");
    expect(r.unknownDueTotal).toBe("500");
  });

  it("**未知到期日的金额单独暴露** —— 否则一笔可能逾期两年的欠款会看着最健康", () => {
    const r = computeAging([{ amount: "10000", dueDate: null }], ASOF);
    expect(r.unknownDueTotal).toBe("10000");
    expect(r.overdueTotal).toBe("0");
    expect(r.buckets.find((b) => b.bucket === "0-30")?.amount).toBe("0");
  });

  it("非法金额按 0 计但仍计入行数,不让整表崩", () => {
    const r = computeAging([{ amount: "abc", dueDate: "2026-07-01" }], ASOF);
    expect(r.total).toBe("0");
    expect(r.buckets.find((b) => b.bucket === "0-30")?.count).toBe(1);
  });

  it("空输入返回全零而不是抛错", () => {
    const r = computeAging([], ASOF);
    expect(r.total).toBe("0");
    expect(r.buckets).toHaveLength(6);
  });
});
