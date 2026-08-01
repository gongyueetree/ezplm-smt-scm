import { describe, expect, it } from "vitest";
import {
  effectiveVerdict,
  summarizeDeclarations,
  VERDICT_TONE,
  type DeclarationInput,
} from "@/lib/domain/compliance-declaration";

const NOW = "2026-08-01T00:00:00.000Z";

function d(over: Partial<DeclarationInput> = {}): DeclarationInput {
  return {
    scheme: "ROHS",
    verdict: "COMPLIANT",
    state: "APPROVED",
    validUntil: "2027-01-01T00:00:00.000Z",
    evidenceCount: 1,
    ...over,
  };
}

describe("生效结论", () => {
  it("已审核、在有效期内、有依据 → 结论生效", () => {
    const r = effectiveVerdict(d(), NOW);
    expect(r.verdict).toBe("COMPLIANT");
    expect(r.degraded).toBe(false);
  });

  it("**未审核的声明不作数**,降级为未知", () => {
    const r = effectiveVerdict(d({ state: "DRAFT" }), NOW);
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.reason).toContain("未审核");
  });

  it("**过期降级为「未知」而不是「不合规」** —— 过期不代表这颗料真的有害", () => {
    const r = effectiveVerdict(d({ validUntil: "2026-01-01T00:00:00.000Z" }), NOW);
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.reason).toContain("过期≠不合规");
  });

  it("**声称符合却没有支撑文档 → 不作数**", () => {
    const r = effectiveVerdict(d({ evidenceCount: 0 }), NOW);
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.reason).toContain("没有任何支撑文档");
  });

  it("不适用是有效结论,不需要文档", () => {
    const r = effectiveVerdict(d({ verdict: "NOT_APPLICABLE", evidenceCount: 0 }), NOW);
    expect(r.verdict).toBe("NOT_APPLICABLE");
    expect(r.degraded).toBe(false);
  });
});

describe("汇总", () => {
  it("没有声明时如实返回未知", () => {
    const s = summarizeDeclarations([], NOW);
    expect(s.map((x) => x.verdict)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    expect(s[0].reason).toContain("尚无");
  });

  it("同体系多份声明时取最新且**生效**的那份", () => {
    const s = summarizeDeclarations(
      [
        { ...d({ verdict: "NON_COMPLIANT" }), issuedAt: "2025-01-01" },
        { ...d({ verdict: "COMPLIANT" }), issuedAt: "2026-06-01" },
      ],
      NOW,
    );
    expect(s.find((x) => x.scheme === "ROHS")!.verdict).toBe("COMPLIANT");
  });

  it("**都不生效时保留降级原因**,不拿旧的凑数", () => {
    const s = summarizeDeclarations(
      [{ ...d({ state: "DRAFT" }), issuedAt: "2026-06-01" }],
      NOW,
    );
    const rohs = s.find((x) => x.scheme === "ROHS")!;
    expect(rohs.verdict).toBe("UNKNOWN");
    expect(rohs.degraded).toBe(true);
  });
});

describe("**未知按告警显示,不是灰色**", () => {
  it("未知用 amber —— 灰色会让人以为无所谓", () => {
    expect(VERDICT_TONE.UNKNOWN).toBe("amber");
    expect(VERDICT_TONE.NOT_APPLICABLE).toBe("gray");
    expect(VERDICT_TONE.NON_COMPLIANT).toBe("red");
  });
});
