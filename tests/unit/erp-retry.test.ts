import { describe, expect, it } from "vitest";
import {
  computeBackoffMs,
  decideRetry,
  deriveJobStatus,
  ERP_RECEIPT_LABEL,
  isPostedInErp,
  isRetryDue,
  isTerminal,
  resumePoint,
  type LineCounts,
} from "@/lib/domain/erp-retry";

function counts(over: Partial<LineCounts> = {}): LineCounts {
  return { created: 0, updated: 0, unchanged: 0, skipped: 0, conflict: 0, failed: 0, ...over };
}

describe("deriveJobStatus:部分成功必须是独立终态", () => {
  it("**有成功也有失败 → PARTIAL_SUCCESS**,不是 FAILED", () => {
    expect(deriveJobStatus(counts({ created: 197, failed: 3 }))).toBe("PARTIAL_SUCCESS");
  });

  it("全失败才是 FAILED", () => {
    expect(deriveJobStatus(counts({ failed: 5 }))).toBe("FAILED");
  });

  it("无失败即成功", () => {
    expect(deriveJobStatus(counts({ created: 10, updated: 5 }))).toBe("SUCCEEDED");
  });

  it("**冲突不算失败** —— 冲突是等人决策,不是同步出错", () => {
    expect(deriveJobStatus(counts({ created: 5, conflict: 3 }))).toBe("SUCCEEDED");
  });

  it("有冲突且有失败 → 部分成功(冲突行也算进了流程)", () => {
    expect(deriveJobStatus(counts({ conflict: 3, failed: 2 }))).toBe("PARTIAL_SUCCESS");
  });

  it("空批次是成功,不是失败", () => {
    expect(deriveJobStatus(counts())).toBe("SUCCEEDED");
  });
});

describe("退避", () => {
  it("指数退避:30s → 2min → 8min", () => {
    expect(computeBackoffMs("EXPONENTIAL", 0)).toBe(30_000);
    expect(computeBackoffMs("EXPONENTIAL", 1)).toBe(120_000);
    expect(computeBackoffMs("EXPONENTIAL", 2)).toBe(480_000);
  });

  it("**有上限**,不会退避到天级别", () => {
    expect(computeBackoffMs("EXPONENTIAL", 20)).toBe(3_600_000);
  });

  it("固定策略恒定;NONE 返回 null", () => {
    expect(computeBackoffMs("FIXED", 5)).toBe(30_000);
    expect(computeBackoffMs("NONE", 0)).toBeNull();
  });
});

describe("decideRetry", () => {
  const base = { maxRetries: 3, backoffStrategy: "EXPONENTIAL" as const };

  it("部分成功且有失败行 → 安排重试", () => {
    const d = decideRetry({ ...base, status: "PARTIAL_SUCCESS", retryCount: 0, counts: counts({ created: 10, failed: 2 }) });
    expect(d.shouldRetry).toBe(true);
    expect(d.nextStatus).toBe("RETRYING");
    expect(d.reason).toContain("仅重试失败行");
  });

  it("**次数耗尽 → DEAD_LETTER 并停止自动重试**(否则会打光外部配额)", () => {
    const d = decideRetry({ ...base, status: "FAILED", retryCount: 3, counts: counts({ failed: 5 }) });
    expect(d.shouldRetry).toBe(false);
    expect(d.nextStatus).toBe("DEAD_LETTER");
    expect(d.reason).toContain("打光外部配额");
  });

  it("**人工触发不受次数与退避限制** —— 人比调度器更清楚现在能不能重试", () => {
    const d = decideRetry({ ...base, status: "FAILED", retryCount: 99, counts: counts({ failed: 1 }), manual: true });
    expect(d.shouldRetry).toBe(true);
    expect(d.delayMs).toBe(0);
  });

  it("没有失败行就不重试,并说明冲突要人工处理", () => {
    const d = decideRetry({ ...base, status: "PARTIAL_SUCCESS", retryCount: 0, counts: counts({ conflict: 4 }) });
    expect(d.shouldRetry).toBe(false);
    expect(d.reason).toContain("冲突");
  });

  it("已取消的作业不重试", () => {
    const d = decideRetry({ ...base, status: "CANCELLED", retryCount: 0, counts: counts({ failed: 3 }) });
    expect(d.shouldRetry).toBe(false);
    expect(d.nextStatus).toBe("CANCELLED");
  });

  it("backoff=NONE 直接转人工", () => {
    const d = decideRetry({ ...base, backoffStrategy: "NONE", status: "FAILED", retryCount: 0, counts: counts({ failed: 1 }) });
    expect(d.nextStatus).toBe("DEAD_LETTER");
  });
});

describe("终态判定", () => {
  it("SUCCEEDED / PARTIAL_SUCCESS / CANCELLED / DEAD_LETTER 是终态", () => {
    for (const s of ["SUCCEEDED", "PARTIAL_SUCCESS", "CANCELLED", "DEAD_LETTER"] as const) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  it("**FAILED 不是终态** —— 它还可以重试", () => {
    expect(isTerminal("FAILED")).toBe(false);
    expect(isTerminal("RETRYING")).toBe(false);
  });
});

describe("isRetryDue", () => {
  it("到点才可重试", () => {
    expect(isRetryDue("2026-08-01T10:00:00Z", "2026-08-01T10:00:01Z")).toBe(true);
    expect(isRetryDue("2026-08-01T10:00:00Z", "2026-08-01T09:59:59Z")).toBe(false);
  });

  it("没有安排时间就不该被调度取走", () => {
    expect(isRetryDue(null, "2026-08-01T10:00:00Z")).toBe(false);
  });
});

describe("resumePoint:已成功的行不重复同步", () => {
  it("从最早的失败行继续,并列出要重试的行号", () => {
    const r = resumePoint([
      { lineNo: 1, outcome: "CREATED" },
      { lineNo: 2, outcome: "FAILED" },
      { lineNo: 3, outcome: "UPDATED" },
      { lineNo: 4, outcome: "FAILED" },
    ]);
    expect(r.fromLineNo).toBe(2);
    expect(r.retryLineNos).toEqual([2, 4]);
    expect(r.skipCount).toBe(1);
  });

  it("**全成功时不重跑任何行**", () => {
    const r = resumePoint([
      { lineNo: 1, outcome: "CREATED" },
      { lineNo: 2, outcome: "UNCHANGED" },
    ]);
    expect(r.retryLineNos).toEqual([]);
    expect(r.fromLineNo).toBe(3);
    expect(r.skipCount).toBe(2);
  });
});

describe("ERP 回执:五种状态不得压成一个成功", () => {
  it("**只有 ERP_POSTED 代表 ERP 里真的有单据**", () => {
    expect(isPostedInErp("ERP_POSTED")).toBe(true);
    for (const s of ["TEMPLATE_GENERATED", "SENT", "ERP_RECEIVED", "ERP_FAILED"] as const) {
      expect(isPostedInErp(s)).toBe(false);
    }
    expect(isPostedInErp(null)).toBe(false);
  });

  it("五种状态都有明确中文标签,措辞互不混淆", () => {
    expect(ERP_RECEIPT_LABEL.TEMPLATE_GENERATED).toBe("已生成模板");
    expect(ERP_RECEIPT_LABEL.SENT).toBe("已发送");
    expect(ERP_RECEIPT_LABEL.ERP_RECEIVED).toBe("ERP 已接收");
    expect(ERP_RECEIPT_LABEL.ERP_POSTED).toBe("ERP 已建单");
    expect(new Set(Object.values(ERP_RECEIPT_LABEL)).size).toBe(5);
  });
});
