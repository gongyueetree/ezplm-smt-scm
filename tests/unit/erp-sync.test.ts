import { describe, expect, it } from "vitest";
import {
  applyTransform,
  canExecute,
  diffRow,
  mapRow,
  summarizeDiff,
  syncIdempotencyKey,
  validateMapping,
} from "@/lib/domain/erp-sync";

describe("字段映射校验", () => {
  it("必需字段未映射 → 指名拦下", () => {
    const issues = validateMapping("MATERIAL", []);
    expect(issues[0].localField).toBe("internalPn");
    expect(issues[0].message).toContain("尚未映射");
  });

  it("映射了但既无 ERP 字段也无默认值 → 仍然拦下", () => {
    const issues = validateMapping("MATERIAL", [{ erpField: "  ", localField: "internalPn" }]);
    expect(issues[0].message).toContain("也没有默认值");
  });

  it("给了默认值就算满足", () => {
    expect(
      validateMapping("MATERIAL", [{ erpField: "", localField: "internalPn", defaultValue: "TBD" }]),
    ).toEqual([]);
  });

  it("**同一本系统字段被重复映射必须拦下** —— 否则结果不确定", () => {
    const issues = validateMapping("MATERIAL", [
      { erpField: "FNumber", localField: "internalPn" },
      { erpField: "FCode", localField: "internalPn" },
    ]);
    expect(issues.some((i) => i.message.includes("重复映射"))).toBe(true);
  });

  it("库存实体要求 internalPn 与 qty", () => {
    const issues = validateMapping("INVENTORY", [{ erpField: "FMaterialId", localField: "internalPn" }]);
    expect(issues.map((i) => i.localField)).toEqual(["qty"]);
  });
});

describe("字段转换:失败要报错,不能静默变 null", () => {
  it("基础转换", () => {
    expect(applyTransform("  abc ", "trim").value).toBe("abc");
    expect(applyTransform("abc", "upper").value).toBe("ABC");
    expect(applyTransform("1,234.50", "decimal").value).toBe("1234.50");
  });

  it("**非法数值报错而不是吞成 null**", () => {
    const r = applyTransform("abc", "decimal");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("不是有效数值");
  });

  it("日期:紧凑格式与常见分隔都认,识别不出报错", () => {
    expect(applyTransform("20260901", "date:YYYYMMDD").value).toBe("2026-09-01");
    expect(applyTransform("2026/9/1", "date").value).toBe("2026-09-01");
    expect(applyTransform("下个月", "date").ok).toBe(false);
  });

  it("未知转换函数报错", () => {
    expect(applyTransform("x", "bogus").ok).toBe(false);
  });

  it("无转换时原样返回", () => {
    expect(applyTransform("x", null).value).toBe("x");
  });
});

describe("mapRow", () => {
  it("按映射取值并转换", () => {
    const r = mapRow(
      { FNumber: " qc-ic-0001 ", FMoq: "1,000" },
      [
        { erpField: "FNumber", localField: "internalPn", transform: "upper" },
        { erpField: "FMoq", localField: "moq", transform: "number" },
      ],
    );
    expect(r.values).toEqual({ internalPn: "QC-IC-0001", moq: "1000" });
    expect(r.errors).toEqual([]);
  });

  it("ERP 侧缺值时回落默认值", () => {
    const r = mapRow({}, [{ erpField: "FUnit", localField: "unit", defaultValue: "PCS" }]);
    expect(r.values.unit).toBe("PCS");
  });

  it("必填但两边都空 → 逐字段报错", () => {
    const r = mapRow({}, [{ erpField: "FNumber", localField: "internalPn", required: true }]);
    expect(r.errors[0]).toContain("必填但 ERP 侧为空");
  });
});

describe("行级差异", () => {
  const erp = { internalPn: "P1", description: "ERP 描述" };

  it("本地没有 → 新增", () => {
    expect(diffRow({ bizKey: "P1", erpValues: erp, localValues: null }).outcome).toBe("CREATED");
  });

  it("完全一致 → 无变化", () => {
    expect(diffRow({ bizKey: "P1", erpValues: erp, localValues: { ...erp } }).outcome).toBe("UNCHANGED");
  });

  it("单向导入下有差异 → 更新,并列出变更字段", () => {
    const r = diffRow({ bizKey: "P1", erpValues: erp, localValues: { internalPn: "P1", description: "本地描述" } });
    expect(r.outcome).toBe("UPDATED");
    expect(r.changedFields).toEqual(["description"]);
  });

  it("**ERP 侧为空不算变更** —— 没给值不等于要清空本地值", () => {
    const r = diffRow({
      bizKey: "P1",
      erpValues: { internalPn: "P1", description: null },
      localValues: { internalPn: "P1", description: "本地有值" },
    });
    expect(r.outcome).toBe("UNCHANGED");
  });

  it("**本地行来自 ezPLM → 一律冲突,ERP 不得覆盖主数据**", () => {
    const r = diffRow({
      bizKey: "P1",
      erpValues: erp,
      localValues: { internalPn: "P1", description: "ezPLM 描述" },
      localOrigin: "EZPLM",
    });
    expect(r.outcome).toBe("CONFLICT");
    expect(r.message).toContain("唯一真源");
  });

  it("**双向同步下两侧不一致 → 冲突,不按最后更新时间覆盖**", () => {
    const r = diffRow(
      { bizKey: "P1", erpValues: erp, localValues: { internalPn: "P1", description: "本地描述" } },
      { bidirectional: true },
    );
    expect(r.outcome).toBe("CONFLICT");
    expect(r.message).toContain("不按最后更新时间自动覆盖");
  });

  it("忽略字段不参与比较", () => {
    const r = diffRow({
      bizKey: "P1",
      erpValues: { internalPn: "P1", updatedAt: "2026-01-01" },
      localValues: { internalPn: "P1", updatedAt: "2025-01-01" },
      ignoreFields: ["updatedAt"],
    });
    expect(r.outcome).toBe("UNCHANGED");
  });
});

describe("执行放行判定", () => {
  const base = { created: 1, updated: 1, unchanged: 0, conflict: 0, skipped: 0, failed: 0, total: 2 };

  it("有解析失败一律不许执行", () => {
    const r = canExecute({ ...base, failed: 2 }, "SKIP_ON_CONFLICT");
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("解析失败");
  });

  it("冲突 + 停止策略 → 不许执行", () => {
    expect(canExecute({ ...base, conflict: 1 }, "STOP_ON_CONFLICT").ok).toBe(false);
  });

  it("冲突 + 跳过/入队策略 → 可执行", () => {
    expect(canExecute({ ...base, conflict: 1 }, "SKIP_ON_CONFLICT").ok).toBe(true);
    expect(canExecute({ ...base, conflict: 1 }, "QUEUE_FOR_HUMAN").ok).toBe(true);
  });
});

describe("汇总与幂等", () => {
  it("按结论计数", () => {
    const s = summarizeDiff([
      { bizKey: "a", outcome: "CREATED", changedFields: [], conflicts: [], message: null },
      { bizKey: "b", outcome: "CONFLICT", changedFields: [], conflicts: [], message: null },
      { bizKey: "c", outcome: "CONFLICT", changedFields: [], conflicts: [], message: null },
    ]);
    expect(s).toMatchObject({ created: 1, conflict: 2, total: 3 });
  });

  it("同一批数据幂等键稳定,不同数据不同", () => {
    const a = syncIdempotencyKey({ connectionId: "c1", entityType: "MATERIAL", mode: "EXECUTE", fingerprint: "f1" });
    const b = syncIdempotencyKey({ connectionId: "c1", entityType: "MATERIAL", mode: "EXECUTE", fingerprint: "f1" });
    const c = syncIdempotencyKey({ connectionId: "c1", entityType: "MATERIAL", mode: "EXECUTE", fingerprint: "f2" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
