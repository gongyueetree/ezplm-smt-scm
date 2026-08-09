/**
 * A-5 回归:BOM 匹配确认的生命周期守卫必须覆盖**采纳候选**这条路径。
 *
 * PR-F 的守卫只看 `input.partId`,而「采纳此候选」只发 `candidateId`
 * (见 app/(app)/bom/version/[versionId]/review.tsx 的 decide()),
 * 于是草稿料点一下就进了正式 BOM。
 *
 * 这里 mock 掉 prisma **真的调用** saveLineDecision,覆盖三种候选来源;
 * E2E(tests/e2e/bom-draft-part-guard.spec.ts)另外守真实点击路径。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface PartRow {
  id: string;
  status: string;
  internalPn: string;
}

const parts = new Map<string, PartRow>();
const candidates = new Map<string, { id: string; partId: string | null }>();
/** 记录事务里是否真的落了决定 —— 被拒时必须一条都不写 */
let decisionWrites = 0;

vi.mock("@/lib/server/db", () => {
  const tx = {
    bomLineDecision: {
      findFirst: () => Promise.resolve(null),
      create: () => {
        decisionWrites++;
        return Promise.resolve({ id: "dec1" });
      },
      updateMany: () => {
        decisionWrites++;
        return Promise.resolve({ count: 1 });
      },
    },
    bOMLine: { update: () => Promise.resolve({}) },
    auditLog: { create: () => Promise.resolve({}) },
  };
  return {
    prisma: {
      bOMLine: { findFirst: () => Promise.resolve({ id: "line1", mpn: "ANY-MPN" }) },
      bomMatchCandidate: {
        findFirst: (args: { where: { id?: string } }) =>
          Promise.resolve(candidates.get(args.where.id ?? "") ?? null),
      },
      part: {
        findFirst: (args: { where: { id?: string } }) =>
          Promise.resolve(parts.get(args.where.id ?? "") ?? null),
      },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

const { saveLineDecision } = await import("@/lib/server/repositories/bom-import");

const SESSION = { tenantId: "t1", userId: "u1" } as never;

beforeEach(() => {
  parts.clear();
  candidates.clear();
  decisionWrites = 0;
  parts.set("p-draft", { id: "p-draft", status: "DRAFT", internalPn: "EE-D-001" });
  parts.set("p-active", { id: "p-active", status: "ACTIVE", internalPn: "EE-A-001" });
  parts.set("p-obsolete", { id: "p-obsolete", status: "OBSOLETE", internalPn: "EE-O-001" });
});

describe("saveLineDecision 的生命周期守卫", () => {
  it("**采纳候选**指向草稿料时必须被拒 —— 这是原实现漏掉的路径", async () => {
    candidates.set("c1", { id: "c1", partId: "p-draft" });
    const r = await saveLineDecision(SESSION, "line1", {
      decision: "ACCEPT_CANDIDATE",
      candidateId: "c1",
      // 注意:**不传 partId** —— 前端「采纳此候选」就是这么发的
    });
    expect(r && "blocked" in r && r.blocked).toBe(true);
    expect(r && "reason" in r ? r.reason : "").toContain("草稿");
    expect(decisionWrites, "被拒时不得写下任何决定").toBe(0);
  });

  it("采纳候选指向已淘汰料时同样被拒,且说明要换替代料", async () => {
    candidates.set("c2", { id: "c2", partId: "p-obsolete" });
    const r = await saveLineDecision(SESSION, "line1", {
      decision: "ACCEPT_CANDIDATE",
      candidateId: "c2",
    });
    expect(r && "blocked" in r && r.blocked).toBe(true);
    expect(r && "reason" in r ? r.reason : "").toContain("替代料");
  });

  it("候选来自三方 Provider(没有本地 partId)时放行 —— 没有生命周期可判,不能瞎拦", async () => {
    candidates.set("c3", { id: "c3", partId: null });
    const r = await saveLineDecision(SESSION, "line1", {
      decision: "ACCEPT_CANDIDATE",
      candidateId: "c3",
    });
    expect(r && "blocked" in r).toBe(false);
    expect(decisionWrites).toBe(1);
  });

  it("采纳候选指向 ACTIVE 料时正常放行", async () => {
    candidates.set("c4", { id: "c4", partId: "p-active" });
    const r = await saveLineDecision(SESSION, "line1", {
      decision: "ACCEPT_CANDIDATE",
      candidateId: "c4",
    });
    expect(r && "blocked" in r).toBe(false);
    expect(decisionWrites).toBe(1);
  });

  it("显式传 partId 的老路径仍然被守住(防回归)", async () => {
    const r = await saveLineDecision(SESSION, "line1", {
      decision: "MANUAL_ASSIGN",
      partId: "p-draft",
    });
    expect(r && "blocked" in r && r.blocked).toBe(true);
  });

  it("同时传 partId 与 candidateId 时以显式 partId 为准 —— 不被候选悄悄改写判定对象", async () => {
    candidates.set("c5", { id: "c5", partId: "p-active" });
    const r = await saveLineDecision(SESSION, "line1", {
      decision: "ACCEPT_CANDIDATE",
      candidateId: "c5",
      partId: "p-draft",
    });
    expect(r && "blocked" in r && r.blocked).toBe(true);
  });
});
