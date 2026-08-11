/**
 * 批量导入建料(`Part.origin = IMPORTED`)。
 *
 * 场景:客户从自有系统导出一批物料,一次性建进来 —— 不是逐个手填。
 *
 * 纪律:
 * - **必需列只有 内部料号 与 MPN**;其余缺了就是缺,留空不猜、不填默认值;
 * - 逐行报错带行号,坏行不拖垮好行;
 * - **重复判定在导入时就要给结论**:内部料号重复=阻断该行;
 *   MPN 疑似重复=标记但不阻断,由人在预览里逐行决定;
 * - 预览与执行分离:先看清楚会建多少、跳多少、撞多少,再决定要不要写。
 */
import { cellText, detectMapping, missingFields, type MappingResult } from "./column-mapping";
import { detectDelimiter, parseCsv } from "./csv";
import { normalizeInternalPn } from "./part-create";

export type PartImportField =
  | "internalPn" | "mpn" | "manufacturer" | "description" | "descriptionEn"
  | "categoryL1" | "categoryL2" | "footprint" | "brand"
  | "msl" | "packaging" | "reelQty" | "moq" | "spq" | "leadTimeDays" | "note"
  // N-12:标准成本(STD 价)。损耗报告按金额分析靠它,由客户在主数据里维护。
  | "standardCost" | "standardCostCurrency";

const SYNONYMS: Record<PartImportField, readonly string[]> = {
  internalPn: ["internalpn", "internal part number", "内部料号", "料号", "物料编码"],
  mpn: ["mpn", "型号", "制造商料号", "厂商型号", "partnumber", "pn"],
  manufacturer: ["manufacturer", "mfg", "制造商", "厂商"],
  description: ["description", "描述", "中文描述", "规格", "名称"],
  descriptionEn: ["descriptionen", "english description", "英文描述"],
  categoryL1: ["category", "分类", "物料分类", "一级分类", "大类"],
  categoryL2: ["subcategory", "二级分类", "细分类"],
  footprint: ["footprint", "package", "封装"],
  brand: ["brand", "品牌"],
  standardCost: ["standardcost", "std price", "stdprice", "标准价", "标准成本", "std 价格", "std价格"],
  standardCostCurrency: ["standardcostcurrency", "标准价币种", "标准成本币种", "std 币种"],
  msl: ["msl", "湿敏等级"],
  packaging: ["packaging", "包装", "包装方式"],
  reelQty: ["reelqty", "盘装数量", "每盘数量"],
  moq: ["moq", "最小起订量"],
  spq: ["spq", "最小包装"],
  leadTimeDays: ["leadtime", "lead time", "lt", "交期"],
  note: ["note", "remark", "备注"],
};

const FIELD_LABEL: Record<PartImportField, string> = {
  internalPn: "内部料号", mpn: "MPN", manufacturer: "制造商", description: "中文描述",
  descriptionEn: "英文描述", categoryL1: "物料分类", categoryL2: "二级分类",
  footprint: "封装", brand: "品牌", msl: "MSL", packaging: "包装方式",
  reelQty: "盘装数量", moq: "MOQ", spq: "SPQ", leadTimeDays: "交期(天)", note: "备注",
  standardCost: "标准价(STD)", standardCostCurrency: "标准价币种",
};

const REQUIRED: readonly PartImportField[] = ["internalPn", "mpn"];

/**
 * 金额类字段保留**原始字符串**交给 Decimal,不经 Number ——
 * 走一遭 number 会在 0.1 这类值上引入误差,而标准价会乘进损耗金额。
 * 非数字或负数返回 null(缺价),不静默变 0。
 */
function decimalStringOrNull(v: string): string | null {
  const t = v.trim().replace(/,/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return t;
}

export interface ParsedImportRow {
  rowNo: number;
  internalPn: string;
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  descriptionEn: string | null;
  categoryL1: string | null;
  categoryL2: string | null;
  footprint: string | null;
  brand: string | null;
  msl: string | null;
  packaging: string | null;
  reelQty: number | null;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  note: string | null;
  /** N-12 标准价(STD)。**保留原始字符串**,不转 number —— 金额要用 Decimal 算 */
  standardCost: string | null;
  standardCostCurrency: string | null;
}

export interface PartImportParseResult {
  mapping: MappingResult<PartImportField>;
  rows: ParsedImportRow[];
  errors: { row: number; message: string }[];
  notices: string[];
}

function intOrNull(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

const EMPTY: MappingResult<PartImportField> = {
  fields: {},
  headerRowIndex: -1,
  unmapped: [],
  confidence: 0,
};

export function parsePartImport(text: string): PartImportParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { mapping: EMPTY, rows: [], errors: [{ row: 0, message: "没有输入内容" }], notices: [] };
  }

  const grid = parseCsv(trimmed, detectDelimiter(trimmed)).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );
  return parsePartImportGrid(grid);
}

/**
 * N-3(客户 PR2 反馈 采购-1d:「批量导入物料以附件(比如 xls)选择进行,不以文本形式进行导入」)。
 *
 * 从**已经是二维网格**的数据继续解析 —— 粘贴文本与上传 xlsx/csv 走的是
 * 同一条列映射 + 校验 + 人工确认链路,只是拿到网格的方式不同。
 * 不为附件另写一套解析:两套逻辑迟早会在"同一份数据两种结论"上分叉。
 */
export function parsePartImportGrid(rawGrid: string[][]): PartImportParseResult {
  const grid = rawGrid.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (grid.length === 0) {
    return { mapping: EMPTY, rows: [], errors: [{ row: 0, message: "未能解析出表格" }], notices: [] };
  }

  const mapping = detectMapping<PartImportField>(grid, SYNONYMS, REQUIRED);
  const errors: { row: number; message: string }[] = [];
  const notices: string[] = [];

  const missing = missingFields(mapping, REQUIRED);
  if (missing.length > 0) {
    errors.push({
      row: mapping.headerRowIndex + 1,
      message: `缺少必需列:${missing.map((f) => FIELD_LABEL[f]).join("、")}`,
    });
    return { mapping, rows: [], errors, notices };
  }

  if (mapping.fields.categoryL1 === undefined) {
    notices.push("未识别到「物料分类」列 —— 导入的物料分类为空,分类驱动的参数模板将不生效");
  }
  if (mapping.fields.manufacturer === undefined) {
    notices.push("未识别到「制造商」列 —— 该字段留空,不做推断");
  }

  const rows: ParsedImportRow[] = [];
  const seenInternalPn = new Map<string, number>();

  for (let i = mapping.headerRowIndex + 1; i < grid.length; i += 1) {
    const row = grid[i];
    const get = (f: PartImportField): string => cellText(row, mapping.fields[f]) ?? "";
    const rowNo = i + 1;

    const internalPnRaw = get("internalPn").trim();
    const mpn = get("mpn").trim();
    if (!internalPnRaw && !mpn) continue;

    if (!internalPnRaw) {
      errors.push({ row: rowNo, message: "缺少内部料号" });
      continue;
    }
    if (!mpn) {
      errors.push({ row: rowNo, message: "缺少 MPN" });
      continue;
    }

    const internalPn = normalizeInternalPn(internalPnRaw);
    // 文件内部自身重复:先在这里拦下,不必等打到数据库唯一约束
    const prev = seenInternalPn.get(internalPn);
    if (prev !== undefined) {
      errors.push({
        row: rowNo,
        message: `内部料号「${internalPn}」在本文件第 ${prev} 行已出现 —— 同一文件内不得重复`,
      });
      continue;
    }
    seenInternalPn.set(internalPn, rowNo);

    rows.push({
      rowNo,
      internalPn,
      mpn,
      manufacturer: get("manufacturer").trim() || null,
      description: get("description").trim() || null,
      descriptionEn: get("descriptionEn").trim() || null,
      categoryL1: get("categoryL1").trim() || null,
      categoryL2: get("categoryL2").trim() || null,
      footprint: get("footprint").trim() || null,
      brand: get("brand").trim() || null,
      msl: get("msl").trim() || null,
      packaging: get("packaging").trim() || null,
      reelQty: intOrNull(get("reelQty")),
      moq: intOrNull(get("moq")),
      spq: intOrNull(get("spq")),
      leadTimeDays: intOrNull(get("leadTimeDays")),
      note: get("note").trim() || null,
      standardCost: decimalStringOrNull(get("standardCost")),
      standardCostCurrency: get("standardCostCurrency").trim().toUpperCase() || null,
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: mapping.headerRowIndex + 1, message: "表头之后没有数据行" });
  }
  return { mapping, rows, errors, notices };
}

export type RowOutcome = "WILL_CREATE" | "BLOCKED_DUPLICATE" | "SUSPECTED_DUPLICATE";

export interface RowPlan {
  rowNo: number;
  internalPn: string;
  mpn: string;
  outcome: RowOutcome;
  reason: string | null;
}

export interface ImportPlan {
  rows: RowPlan[];
  willCreate: number;
  blocked: number;
  suspected: number;
}

/**
 * 结合库内现状给出**逐行计划**。
 *
 * - 内部料号已存在 → 阻断该行(唯一约束就是这么定的);
 * - MPN 已存在但内部料号不同 → 疑似重复,**不阻断**,但要在预览里显式标出,
 *   由人决定是否仍然创建 —— 与手工建料同一套口径,不静默放行也不静默丢弃。
 */
export function planImport(
  rows: readonly ParsedImportRow[],
  existing: { internalPns: ReadonlySet<string>; mpns: ReadonlySet<string> },
): ImportPlan {
  const plans: RowPlan[] = rows.map((r) => {
    if (existing.internalPns.has(r.internalPn)) {
      return {
        rowNo: r.rowNo,
        internalPn: r.internalPn,
        mpn: r.mpn,
        outcome: "BLOCKED_DUPLICATE" as const,
        reason: `内部料号「${r.internalPn}」已存在于本租户 —— 内部料号必须唯一`,
      };
    }
    if (existing.mpns.has(r.mpn.toUpperCase())) {
      return {
        rowNo: r.rowNo,
        internalPn: r.internalPn,
        mpn: r.mpn,
        outcome: "SUSPECTED_DUPLICATE" as const,
        reason: `本租户已有相同 MPN「${r.mpn}」的物料 —— 可能重复,请确认是否仍要新建`,
      };
    }
    return { rowNo: r.rowNo, internalPn: r.internalPn, mpn: r.mpn, outcome: "WILL_CREATE" as const, reason: null };
  });

  return {
    rows: plans,
    willCreate: plans.filter((p) => p.outcome === "WILL_CREATE").length,
    blocked: plans.filter((p) => p.outcome === "BLOCKED_DUPLICATE").length,
    suspected: plans.filter((p) => p.outcome === "SUSPECTED_DUPLICATE").length,
  };
}

export const IMPORT_TEMPLATE_HEADERS = [
  "内部料号", "MPN", "制造商", "中文描述", "物料分类", "二级分类",
  "封装", "MSL", "包装方式", "盘装数量", "MOQ", "SPQ", "交期", "备注",
];
