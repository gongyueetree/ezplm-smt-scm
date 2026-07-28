/**
 * BOM 导入校验(SPEC §6:重复位号检测、EOL/禁用料检测、封装不一致检测)。
 *
 * 纪律:校验只产出「事实标记」,不代替人工决策;
 * 每条问题都带可回溯的行号与位号,便于人工回原表核对。
 */
import type { LifecycleValue } from "@/lib/providers/common/normalized-offer";
import type { ParsedBomLine } from "./bom-parse";

/** 位号串展开:"R1,R2"、"R1-R5"、"C1~C3"、"R1 R2"、"R1-5" */
export function expandRefDes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const tokens = raw
    .replace(/[;、，]/g, ",")
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const token of tokens) {
    const range = token.match(/^([A-Za-z]+)(\d+)\s*[-~—]\s*([A-Za-z]*)(\d+)$/);
    if (range) {
      const [, prefix, startStr, endPrefix, endStr] = range;
      // "R1-C5" 这种前缀不一致的不做展开,原样保留(避免臆造位号)
      if (endPrefix && endPrefix.toUpperCase() !== prefix.toUpperCase()) {
        out.push(token.toUpperCase());
        continue;
      }
      const start = Number(startStr);
      const end = Number(endStr);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 10000) {
        for (let n = start; n <= end; n++) out.push(`${prefix.toUpperCase()}${n}`);
        continue;
      }
    }
    out.push(token.toUpperCase());
  }
  return out;
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

/** 封装归一:去空格与分隔符、大写。"0603" ≡ "0603";"SOIC-16" ≡ "SOIC16" */
export function normalizeFootprint(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
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

/** 解析阶段产生的问题(数量非法等)转为统一 issue */
export function parseIssuesToBomIssues(lines: ParsedBomLine[]): BomIssue[] {
  return lines.flatMap((l) =>
    l.issues.map((message) => ({
      level: "error" as const,
      code: "parse_issue" as const,
      message: `第 ${l.lineNo} 行:${message}`,
      lineNos: [l.lineNo],
    })),
  );
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
