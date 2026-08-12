/**
 * 替代料**批量导入/导出**的解析与校验(纯函数)。
 *
 * 客户 Q9:「**物料替代的批量导入导出**和**预 BOM 的批量导入导出**,都需要输入口」。
 *
 * 三条硬规矩(客户在指令里点名的):
 *
 * 1. **任何一行有问题都逐行报错**,不是整批一句"格式不对";
 * 2. **不自动新建 Part** —— 基准料或替代料不在库里就报错,让人先建料。
 *    ezPLM 是物料主数据唯一真源,导入几次长出一堆同名料是最难收拾的烂摊子;
 * 3. **兼容级别非法即报错**,不猜、不回落到 UNKNOWN ——
 *    把"FUNCTIONAL"这种写错的值悄悄当成"未知",等于把人的笔误变成系统结论。
 */
import { detectMapping, missingFields, type MappingResult } from "@/lib/domain/column-mapping";
import {
  FUNCTIONAL_VALUES,
  PACKAGE_VALUES,
  PIN_VALUES,
  type FunctionalEquivalence,
  type PackageCompatibility,
  type PinCompatibility,
} from "@/lib/domain/alternate-compat";

export type AlternateImportField =
  | "basePn"
  | "baseMfg"
  | "baseMpn"
  | "altMfg"
  | "altMpn"
  | "altPn"
  | "functional"
  | "packageCompat"
  | "pin"
  | "reason"
  | "source"
  | "approvedBy"
  | "note";

export const FIELD_LABEL: Record<AlternateImportField, string> = {
  basePn: "基准内部料号",
  baseMfg: "基准制造商",
  baseMpn: "基准 MPN",
  altPn: "替代内部料号",
  altMfg: "替代制造商",
  altMpn: "替代 MPN",
  functional: "功能等效",
  packageCompat: "封装兼容",
  pin: "引脚兼容",
  reason: "判定依据",
  source: "依据来源",
  approvedBy: "确认人",
  note: "备注",
};

const SYNONYMS: Record<AlternateImportField, string[]> = {
  basePn: ["基准内部料号", "基准料号", "内部料号", "baseinternalpn", "basepn", "主料号"],
  baseMfg: ["基准制造商", "基准厂商", "basemfg", "basemanufacturer", "主料制造商"],
  baseMpn: ["基准mpn", "基准型号", "basempn", "主料mpn"],
  altPn: ["替代内部料号", "替代料号", "alternateinternalpn", "altpn"],
  altMfg: ["替代制造商", "替代厂商", "altmfg", "alternatemfg", "alternatemanufacturer"],
  altMpn: ["替代mpn", "替代型号", "altmpn", "alternatempn"],
  functional: ["功能等效", "功能一致", "功能兼容", "functionalequivalence", "functional"],
  packageCompat: ["封装兼容", "封装一致", "packagecompatibility", "packagecompat", "package"],
  pin: ["引脚兼容", "引脚一致", "pincompatibility", "pincompat", "pin"],
  reason: ["判定依据", "依据", "原因", "reason"],
  source: ["依据来源", "来源", "source", "evidencesource"],
  approvedBy: ["确认人", "审核人", "approvedby", "approver"],
  note: ["备注", "说明", "note", "remark"],
};

/**
 * 必需列:两端各要一个能唯一定位的料号 + 三个兼容维度。
 *
 * 用**内部料号**而不是 MPN 定位:MPN 可能对应多颗内部料(实测种子库里
 * 一个 MPN 挂过 64 颗),拿 MPN 当键会让导入变成随机挑一颗。
 */
const REQUIRED: AlternateImportField[] = ["basePn", "altPn", "functional", "packageCompat", "pin"];

export interface AlternateImportRow {
  /** 源文件行号(1 基),报错要指得回原表 */
  rowNo: number;
  basePn: string;
  altPn: string;
  baseMfg: string | null;
  baseMpn: string | null;
  altMfg: string | null;
  altMpn: string | null;
  functional: FunctionalEquivalence;
  packageCompat: PackageCompatibility;
  pin: PinCompatibility;
  reason: string | null;
  source: string | null;
  approvedBy: string | null;
  note: string | null;
}

export interface AlternateRowError {
  rowNo: number;
  message: string;
}

export interface AlternateImportParseResult {
  mapping: MappingResult<AlternateImportField>;
  rows: AlternateImportRow[];
  errors: AlternateRowError[];
  /** 表头缺列这类整表级问题 */
  fatal: string | null;
}

function cell(row: string[], idx: number | undefined): string | null {
  if (idx === undefined) return null;
  const v = (row[idx] ?? "").trim();
  return v === "" ? null : v;
}

/** 兼容级别:大小写与空格无关,但**写错就是错**,不回落 UNKNOWN */
function parseLevel<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  label: string,
  rowNo: number,
  errors: AlternateRowError[],
): T | null {
  if (raw === null) {
    errors.push({ rowNo, message: `${label}为空 —— 三个兼容维度都是必填(不确定请显式填 UNKNOWN)` });
    return null;
  }
  const key = raw.trim().toUpperCase().replace(/[\s-]/g, "_");
  const hit = allowed.find((a) => a === key);
  if (!hit) {
    errors.push({
      rowNo,
      message: `${label}「${raw}」不是合法取值。可用:${allowed.join(" / ")}`,
    });
    return null;
  }
  return hit;
}

export function parseAlternateImportGrid(rawGrid: string[][]): AlternateImportParseResult {
  const grid = rawGrid.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  const empty = { fields: {}, headerRowIndex: 0, unmapped: [], confidence: 0 } as MappingResult<AlternateImportField>;
  if (grid.length === 0) {
    return { mapping: empty, rows: [], errors: [], fatal: "未能从文件里解析出表格内容" };
  }

  const mapping = detectMapping<AlternateImportField>(grid, SYNONYMS, REQUIRED);
  const missing = missingFields(mapping, REQUIRED);
  if (missing.length > 0) {
    return {
      mapping,
      rows: [],
      errors: [],
      fatal: `缺少必需列:${missing.map((f) => FIELD_LABEL[f]).join("、")}。请用「下载导入模板」里的表头。`,
    };
  }

  const rows: AlternateImportRow[] = [];
  const errors: AlternateRowError[] = [];

  for (let i = mapping.headerRowIndex + 1; i < grid.length; i++) {
    const rowNo = i + 1;
    const r = grid[i];
    const basePn = cell(r, mapping.fields.basePn);
    const altPn = cell(r, mapping.fields.altPn);

    if (!basePn && !altPn) continue; // 整行空白:上面已过滤,这里是保险

    if (!basePn) {
      errors.push({ rowNo, message: "基准内部料号为空" });
      continue;
    }
    if (!altPn) {
      errors.push({ rowNo, message: "替代内部料号为空" });
      continue;
    }
    if (basePn.toUpperCase() === altPn.toUpperCase()) {
      errors.push({ rowNo, message: `基准料与替代料是同一个料号(${basePn})` });
      continue;
    }

    const before = errors.length;
    const functional = parseLevel(cell(r, mapping.fields.functional), FUNCTIONAL_VALUES, "功能等效", rowNo, errors);
    const packageCompat = parseLevel(cell(r, mapping.fields.packageCompat), PACKAGE_VALUES, "封装兼容", rowNo, errors);
    const pin = parseLevel(cell(r, mapping.fields.pin), PIN_VALUES, "引脚兼容", rowNo, errors);
    if (errors.length > before) continue;

    rows.push({
      rowNo,
      basePn,
      altPn,
      baseMfg: cell(r, mapping.fields.baseMfg),
      baseMpn: cell(r, mapping.fields.baseMpn),
      altMfg: cell(r, mapping.fields.altMfg),
      altMpn: cell(r, mapping.fields.altMpn),
      functional: functional!,
      packageCompat: packageCompat!,
      pin: pin!,
      reason: cell(r, mapping.fields.reason),
      source: cell(r, mapping.fields.source),
      approvedBy: cell(r, mapping.fields.approvedBy),
      note: cell(r, mapping.fields.note),
    });
  }

  return { mapping, rows, errors, fatal: null };
}

export interface ResolveContext {
  /** 归一化内部料号 → partId */
  partIdByInternalPn: ReadonlyMap<string, string>;
}

export interface ResolvedRow extends AlternateImportRow {
  basePartId: string;
  altPartId: string;
}

export interface ResolveResult {
  resolved: ResolvedRow[];
  errors: AlternateRowError[];
}

export function normalizePn(v: string): string {
  return v.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * 把料号解析成 partId。
 *
 * **查不到就报错,绝不建料。** 这是客户点名的一条,也是主数据纪律:
 * 自动建料会让一次手滑的导入在物料库里留下永久痕迹。
 */
export function resolveRows(rows: readonly AlternateImportRow[], ctx: ResolveContext): ResolveResult {
  const resolved: ResolvedRow[] = [];
  const errors: AlternateRowError[] = [];

  for (const row of rows) {
    const basePartId = ctx.partIdByInternalPn.get(normalizePn(row.basePn));
    const altPartId = ctx.partIdByInternalPn.get(normalizePn(row.altPn));
    if (!basePartId) {
      errors.push({
        rowNo: row.rowNo,
        message: `基准料号 ${row.basePn} 在物料库里不存在 —— 请先建料,系统不会自动建`,
      });
      continue;
    }
    if (!altPartId) {
      errors.push({
        rowNo: row.rowNo,
        message: `替代料号 ${row.altPn} 在物料库里不存在 —— 请先建料,系统不会自动建`,
      });
      continue;
    }
    resolved.push({ ...row, basePartId, altPartId });
  }

  return { resolved, errors };
}

/** 导入模板表头(导出与模板下载共用一套,避免两处对不上) */
export const TEMPLATE_HEADER: AlternateImportField[] = [
  "basePn",
  "baseMfg",
  "baseMpn",
  "altPn",
  "altMfg",
  "altMpn",
  "functional",
  "packageCompat",
  "pin",
  "reason",
  "source",
  "approvedBy",
  "note",
];

export const TEMPLATE_HEADER_LABELS = TEMPLATE_HEADER.map((f) => FIELD_LABEL[f]);
