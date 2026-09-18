/**
 * BOM 导入校验(SPEC §6:重复位号检测、EOL/禁用料检测、封装不一致检测)。
 *
 * 纪律:校验只产出「事实标记」,不代替人工决策;
 * 每条问题都带可回溯的行号与位号,便于人工回原表核对。
 */
import type { LifecycleValue } from "@/lib/providers/common/normalized-offer";
import type { ParsedBomLine } from "./bom-parse";
import { parseReferences } from "@/modules/bom/domain/reference-designator";
import { footprintKey } from "@/modules/bom/domain/package-normalize";

/**
 * 位号串展开:"R1,R2"、"R1-R5"、"C1~C3"、"R1 R2"、"R1-5"。
 *
 * REF-2a:转调 canonical `parseReferences`。对既有写法结果不变;
 * 新增支持全角分号、连接号/全角波浪/省略号等范围符(此前 `R1–R10` 只算 1 个)。
 * @deprecated 请直接用 `modules/bom/domain/reference-designator.parseReferences`。
 */
export function expandRefDes(raw: string | null | undefined): string[] {
  return parseReferences(raw).refs;
}

export type BomIssueLevel = "error" | "warning";

export interface BomIssue {
  level: BomIssueLevel;
  code:
    | "duplicate_refdes"
    | "qty_refdes_mismatch"
    | "eol_part"
    | "footprint_mismatch"
    | "parse_issue";
  message: string;
  /** 涉及的 BOM 行号(可多行,如重复位号跨行) */
  lineNos: number[];
  refDes?: string;
}

/**
 * 重复位号检测:同一位号出现在多行(或同一行内重复)即为错误 ——
 * 一个位置只能装一颗料,重复意味着 BOM 本身有误。
 */
export function detectDuplicateRefDes(lines: ParsedBomLine[]): BomIssue[] {
  const seen = new Map<string, number[]>();
  for (const line of lines) {
    const list = expandRefDes(line.refDes);
    const withinLine = new Set<string>();
    for (const rd of list) {
      // 行内重复也要记(如 "R1,R1")
      const key = rd;
      const rows = seen.get(key) ?? [];
      if (!withinLine.has(key) || !rows.includes(line.lineNo)) rows.push(line.lineNo);
      withinLine.add(key);
      seen.set(key, rows);
    }
    // 行内自重复单独检测
    const counts = new Map<string, number>();
    for (const rd of list) counts.set(rd, (counts.get(rd) ?? 0) + 1);
    for (const [rd, c] of counts) {
      if (c > 1) {
        const rows = seen.get(rd)!;
        if (!rows.includes(line.lineNo)) rows.push(line.lineNo);
      }
    }
  }

  const issues: BomIssue[] = [];
  for (const [refDes, lineNos] of seen) {
    const duplicatedAcrossLines = lineNos.length > 1;
    const duplicatedWithinLine = lines.some((l) => {
      const list = expandRefDes(l.refDes);
      return list.filter((x) => x === refDes).length > 1;
    });
    if (duplicatedAcrossLines || duplicatedWithinLine) {
      issues.push({
        level: "error",
        code: "duplicate_refdes",
        message: `位号 ${refDes} 重复出现${duplicatedAcrossLines ? `(行 ${lineNos.join("、")})` : "(同一行内重复)"}`,
        lineNos,
        refDes,
      });
    }
  }
  return issues.sort((a, b) => (a.refDes ?? "").localeCompare(b.refDes ?? ""));
}

/** 数量与位号个数不一致(有位号时才校验);属提示级,不阻断导入 */
export function detectQtyRefDesMismatch(lines: ParsedBomLine[]): BomIssue[] {
  const issues: BomIssue[] = [];
  for (const line of lines) {
    const count = expandRefDes(line.refDes).length;
    if (count > 0 && line.qty !== null && line.qty !== count) {
      issues.push({
        level: "warning",
        code: "qty_refdes_mismatch",
        message: `第 ${line.lineNo} 行数量 ${line.qty} 与位号个数 ${count} 不一致`,
        lineNos: [line.lineNo],
      });
    }
  }
  return issues;
}

export interface LifecycleLookup {
  /** 按 MPN 取生命周期;未知返回 UNKNOWN */
  (mpn: string): LifecycleValue | undefined;
}

/** EOL / 停产 / 不推荐新设计 检测 */
export function detectEolParts(lines: ParsedBomLine[], lookup: LifecycleLookup): BomIssue[] {
  const issues: BomIssue[] = [];
  for (const line of lines) {
    if (!line.mpn) continue;
    const lc = lookup(line.mpn);
    if (lc === "EOL" || lc === "OBSOLETE") {
      issues.push({
        level: "error",
        code: "eol_part",
        message: `第 ${line.lineNo} 行 ${line.mpn} 生命周期为 ${lc},需替换或确认库存可满足`,
        lineNos: [line.lineNo],
      });
    } else if (lc === "NRND") {
      issues.push({
        level: "warning",
        code: "eol_part",
        message: `第 ${line.lineNo} 行 ${line.mpn} 为 NRND(不推荐用于新设计)`,
        lineNos: [line.lineNo],
      });
    }
  }
  return issues;
}

export interface FootprintLookup {
  /** 按 MPN 取主数据封装;未知返回 undefined */
  (mpn: string): string | undefined;
}

/** 封装归一:去空格与分隔符、大写。"0603" ≡ "0603";"SOIC-16" ≡ "SOIC16"
 * @deprecated 请直接用 `modules/bom/domain/package-normalize.footprintKey`。 */
export function normalizeFootprint(raw: string | null | undefined): string {
  // REF-2a:转调 canonical footprintKey(与 MPN 键同一套字符规则)
  return footprintKey(raw);
}

/** 封装不一致:BOM 行封装与主数据封装不同 */
export function detectFootprintMismatch(
  lines: ParsedBomLine[],
  lookup: FootprintLookup,
): BomIssue[] {
  const issues: BomIssue[] = [];
  for (const line of lines) {
    if (!line.mpn || !line.footprint) continue;
    const master = lookup(line.mpn);
    if (!master) continue;
    if (normalizeFootprint(master) !== normalizeFootprint(line.footprint)) {
      issues.push({
        level: "error",
        code: "footprint_mismatch",
        message: `第 ${line.lineNo} 行 ${line.mpn} 封装不一致:BOM「${line.footprint}」vs 主数据「${master}」`,
        lineNos: [line.lineNo],
      });
    }
  }
  return issues;
}

/**
 * 解析阶段产生的问题转为统一 issue。
 * issues = 错误(挡住流程);notices = 提示(如 MPN 由 Value 推断,需人工确认)——
 * 两者级别必须分开,否则"待确认"会被当成"有错",人反而不看了。
 */
export function parseIssuesToBomIssues(lines: ParsedBomLine[]): BomIssue[] {
  return lines.flatMap((l) => [
    ...l.issues.map((message) => ({
      level: "error" as const,
      code: "parse_issue" as const,
      message: `第 ${l.lineNo} 行:${message}`,
      lineNos: [l.lineNo],
    })),
    ...(l.notices ?? []).map((message) => ({
      level: "warning" as const,
      code: "parse_issue" as const,
      message: `第 ${l.lineNo} 行:${message}`,
      lineNos: [l.lineNo],
    })),
  ]);
}

export interface ValidationContext {
  lifecycleOf?: LifecycleLookup;
  footprintOf?: FootprintLookup;
}

export interface ValidationReport {
  issues: BomIssue[];
  errorCount: number;
  warningCount: number;
  /** 有 error 即需人工处理后才可进入匹配确认 */
  blocked: boolean;
}

export function validateBomLines(
  lines: ParsedBomLine[],
  ctx: ValidationContext = {},
): ValidationReport {
  const issues = [
    ...parseIssuesToBomIssues(lines),
    ...detectDuplicateRefDes(lines),
    ...detectQtyRefDesMismatch(lines),
    ...(ctx.lifecycleOf ? detectEolParts(lines, ctx.lifecycleOf) : []),
    ...(ctx.footprintOf ? detectFootprintMismatch(lines, ctx.footprintOf) : []),
  ];
  const errorCount = issues.filter((i) => i.level === "error").length;
  return {
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
    blocked: errorCount > 0,
  };
}
