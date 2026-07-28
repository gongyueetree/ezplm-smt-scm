import { describe, expect, it } from "vitest";
import {
  REMINDER_LEAD_DAYS,
  collectReminderCandidates,
  daysBetween,
  deriveAnomalyRows,
  deriveDiffRows,
  deriveNoReplyLines,
  deriveOpoKpi,
  effectiveEta,
  evaluateOpoLine,
  shouldRemind,
  type OpoLineView,
} from "@/lib/domain/opo";

const NOW = "2026-07-28T00:00:00.000Z";

function line(patch: Partial<OpoLineView>): OpoLineView {
  return {
    id: "l1",
    poNo: "PO-001",
    lineNo: 1,
    supplierId: "sup-1",
    mpn: "STM32F103C8T6",
    qtyOrdered: 1000,
    qtyOpen: 1000,
    promiseDate: "2026-08-10T00:00:00.000Z",
    needDate: "2026-08-15T00:00:00.000Z",
    latestReply: null,
    ...patch,
  };
}

const REPLY = {
  replyEta: "2026-08-12T00:00:00.000Z",
  replyQty: 1000,
  replyNote: null,
  replyAt: "2026-07-27T00:00:00.000Z",
  replySource: "EMAIL" as const,
};

describe("基础派生", () => {
  it("daysBetween 计算整天差,空值安全", () => {
    expect(daysBetween("2026-07-28T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).toBe(4);
    expect(daysBetween("2026-08-01T00:00:00.000Z", "2026-07-28T00:00:00.000Z")).toBe(-4);
    expect(daysBetween(null, NOW)).toBeNull();
    expect(daysBetween("bad", NOW)).toBeNull();
  });

  it("有效 ETA:回复优先于 ERP 承诺", () => {
    expect(effectiveEta(line({ latestReply: REPLY }))).toBe(REPLY.replyEta);
    expect(effectiveEta(line({}))).toBe("2026-08-10T00:00:00.000Z");
    expect(effectiveEta(line({ promiseDate: null }))).toBeNull();
  });
});

describe("异常判定(派生,不落库)", () => {
  it("未回复标 warning", () => {
    const a = evaluateOpoLine(line({}), NOW);
    expect(a.map((x) => x.code)).toContain("no_reply");
  });

  it("ETA 晚于需求日期标 error", () => {
    const a = evaluateOpoLine(
      line({ latestReply: { ...REPLY, replyEta: "2026-08-20T00:00:00.000Z" } }),
      NOW,
    );
    const hit = a.find((x) => x.code === "eta_later_than_need")!;
    expect(hit.level).toBe("error");
    expect(hit.message).toContain("5 天");
  });

  it("回复 ETA 晚于 ERP 承诺标 warning", () => {
    const a = evaluateOpoLine(line({ latestReply: REPLY }), NOW);
    const hit = a.find((x) => x.code === "eta_later_than_promise")!;
    expect(hit.level).toBe("warning");
    expect(hit.message).toContain("2 天");
  });

  it("回复数量少于未交数量标 error", () => {
    const a = evaluateOpoLine(line({ latestReply: { ...REPLY, replyQty: 800 } }), NOW);
    expect(a.some((x) => x.code === "qty_short" && x.level === "error")).toBe(true);
  });

  it("既无回复也无承诺交期标 error", () => {
    const a = evaluateOpoLine(line({ promiseDate: null }), NOW);
    expect(a.some((x) => x.code === "missing_eta" && x.level === "error")).toBe(true);
  });

  it("已过 ETA 仍有未交量标 error;已交清则不标", () => {
    const overdue = line({ promiseDate: "2026-07-20T00:00:00.000Z", latestReply: null });
    expect(evaluateOpoLine(overdue, NOW).some((x) => x.code === "overdue")).toBe(true);
    expect(
      evaluateOpoLine({ ...overdue, qtyOpen: 0 }, NOW).some((x) => x.code === "overdue"),
    ).toBe(false);
  });

  it("完全正常的行无异常", () => {
    const ok = line({
      needDate: "2026-09-01T00:00:00.000Z",
      promiseDate: "2026-08-12T00:00:00.000Z",
      latestReply: { ...REPLY, replyEta: "2026-08-12T00:00:00.000Z" },
    });
    expect(evaluateOpoLine(ok, NOW)).toEqual([]);
  });
});

describe("KPI 与各表同源派生(SPEC §14 铁律)", () => {
  const lines = [
    // 正常
    line({
      id: "ok",
      needDate: "2026-09-01T00:00:00.000Z",
      promiseDate: "2026-08-12T00:00:00.000Z",
      latestReply: { ...REPLY, replyEta: "2026-08-12T00:00:00.000Z" },
    }),
    // 未回复(warning)
    line({ id: "noreply", needDate: "2026-09-01T00:00:00.000Z" }),
    // 回复晚于需求(error)
    line({
      id: "late",
      latestReply: { ...REPLY, replyEta: "2026-08-20T00:00:00.000Z" },
    }),
    // 数量不足(error)
    line({
      id: "short",
      needDate: "2026-09-01T00:00:00.000Z",
      promiseDate: "2026-08-12T00:00:00.000Z",
      latestReply: { ...REPLY, replyEta: "2026-08-12T00:00:00.000Z", replyQty: 500 },
    }),
  ];

  it("各分类互斥且求和等于总行数(防旁路计数对不上账)", () => {
    const kpi = deriveOpoKpi(lines, NOW);
    expect(kpi.totalLines).toBe(4);
    expect(kpi.errorLines + kpi.warningLines + kpi.healthyLines).toBe(kpi.totalLines);
    expect(kpi.errorLines).toBe(2);
    expect(kpi.warningLines).toBe(1);
    expect(kpi.healthyLines).toBe(1);
  });

  it("未交总量与回复率由同一份行数据算出", () => {
    const kpi = deriveOpoKpi(lines, NOW);
    expect(kpi.totalOpenQty).toBe(4000);
    expect(kpi.noReplyLines).toBe(1);
    expect(kpi.replyRate).toBe(0.75);
  });

  it("未回复表与 KPI 的未回复数一致", () => {
    const kpi = deriveOpoKpi(lines, NOW);
    expect(deriveNoReplyLines(lines)).toHaveLength(kpi.noReplyLines);
    expect(deriveNoReplyLines(lines)[0].id).toBe("noreply");
  });

  it("异常清单与 KPI 的异常行数一致", () => {
    const kpi = deriveOpoKpi(lines, NOW);
    expect(deriveAnomalyRows(lines, NOW)).toHaveLength(kpi.errorLines + kpi.warningLines);
  });

  it("差异表只列与 ERP 承诺有差异的行", () => {
    const rows = deriveDiffRows(lines);
    const ids = rows.map((r) => r.line.id);
    expect(ids).toContain("late"); // ETA 差 10 天
    expect(ids).toContain("short"); // 数量差 -500
    expect(ids).not.toContain("ok"); // 无差异
    expect(ids).not.toContain("noreply"); // 无回复不入差异表
    expect(rows.find((r) => r.line.id === "short")!.qtyDelta).toBe(-500);
  });

  it("空数据集不产生除零", () => {
    const kpi = deriveOpoKpi([], NOW);
    expect(kpi).toMatchObject({ totalLines: 0, replyRate: 0, totalOpenQty: 0 });
    expect(deriveDiffRows([])).toEqual([]);
  });
});

describe("催办规则(SPEC §14:提前四天 + 幂等键)", () => {
  it("提前天数常量为 4", () => {
    expect(REMINDER_LEAD_DAYS).toBe(4);
  });

  it("ETA 在 4 天内触发催办", () => {
    const c = shouldRemind(line({ promiseDate: "2026-08-01T00:00:00.000Z" }), NOW);
    expect(c).not.toBeNull();
    expect(c!.daysUntilEta).toBe(4);
  });

  it("ETA 超过 4 天不催办", () => {
    expect(shouldRemind(line({ promiseDate: "2026-08-02T00:00:00.000Z" }), NOW)).toBeNull();
  });

  it("已过期(ETA 早于今天)不进催办队列", () => {
    expect(shouldRemind(line({ promiseDate: "2026-07-20T00:00:00.000Z" }), NOW)).toBeNull();
  });

  it("已交清不催办", () => {
    expect(
      shouldRemind(line({ qtyOpen: 0, promiseDate: "2026-08-01T00:00:00.000Z" }), NOW),
    ).toBeNull();
  });

  it("无任何 ETA 不催办(不臆造提醒时点)", () => {
    expect(shouldRemind(line({ promiseDate: null }), NOW)).toBeNull();
  });

  it("幂等键含行 ID + ETA + 当天:同日重复扫描键相同,ETA 变更后键变化", () => {
    const l = line({ promiseDate: "2026-08-01T00:00:00.000Z" });
    const a = shouldRemind(l, NOW)!;
    const b = shouldRemind(l, "2026-07-28T09:30:00.000Z")!;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);

    const moved = shouldRemind({ ...l, promiseDate: "2026-07-31T00:00:00.000Z" }, NOW)!;
    expect(moved.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it("回复 ETA 优先于 ERP 承诺参与催办判定", () => {
    const l = line({
      promiseDate: "2026-08-20T00:00:00.000Z",
      latestReply: { ...REPLY, replyEta: "2026-07-30T00:00:00.000Z" },
    });
    const c = shouldRemind(l, NOW)!;
    expect(c.daysUntilEta).toBe(2);
  });

  it("扫描结果按紧急度排序且确定", () => {
    const lines = [
      line({ id: "b", promiseDate: "2026-08-01T00:00:00.000Z" }),
      line({ id: "a", promiseDate: "2026-07-29T00:00:00.000Z" }),
      line({ id: "far", promiseDate: "2026-09-01T00:00:00.000Z" }),
    ];
    const got = collectReminderCandidates(lines, NOW);
    expect(got.map((c) => c.line.id)).toEqual(["a", "b"]);
  });
});
