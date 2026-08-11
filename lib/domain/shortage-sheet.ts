/**
 * 缺料分析单:解析与状态机(纯函数)。
 *
 * PR2-PROC-10 —— 客户原话:「缺料分析是根据**缺料分析单**来的,而非 BOM」。
 *
 * 与 `/shortage` 既有的「按 BOM × 台数推算」的区别必须说清:
 * - 那是**核算工具**:给定 BOM 和台数,算出理论缺口;
 * - 这是**业务单据**:别的系统/人已经认定了缺口,进来的是事实,不是推算结果。
 *
 * 所以本模块**绝不重算 shortageQty** —— 单据说缺 500 就是 500。
 * 系统若拿库存去"纠正"它,就等于用一份可能过期的缓存去否定业务判断。
 */
import { Decimal } from "decimal.js";
import { detectMapping, missingFields } from "./column-mapping";

export type ShortageField =
  | "customer"
  | "internalPn"
  | "manufacturer"
  | "mpn"
  | "requiredQty"
  | "availableInventory"
  | "openPoQty"
  | "supplier"
  | "eta"
  | "shortageQty"
  | "requiredDate";

export const SHORTAGE_FIELD_LABEL: Record<ShortageField, string> = {
  customer: "客户",
  internalPn: "内部料号",
  manufacturer: "制造商",
  mpn: "MPN",
  requiredQty: "需求数量",
  availableInventory: "可用库存",
  openPoQty: "在途",
  supplier: "供应商",
  eta: "ETA",
  shortageQty: "缺口数量",
  requiredDate: "需求日期",
};

const SYNONYMS: Record<ShortageField, string[]> = {
  customer: ["客户", "customer", "客户名称"],
  internalPn: ["内部料号", "料号", "internalpn", "物料编码", "pn"],
  manufacturer: ["制造商", "厂商", "manufacturer", "mfg", "品牌"],
  mpn: ["mpn", "型号", "厂商型号", "partnumber"],
  requiredQty: ["需求数量", "需求量", "requiredqty", "需求"],
  availableInventory: ["可用库存", "库存", "availableinventory", "inventory", "onhand"],
  openPoQty: ["在途", "未交", "openpo", "openpoqty", "在途数量"],
  supplier: ["供应商", "supplier", "vendor"],
  eta: ["eta", "预计到货", "到货日期"],
  shortageQty: ["缺口数量", "缺口", "shortage", "shortageqty", "缺料数量"],
  requiredDate: ["需求日期", "requireddate", "需求时间", "要求交期"],
};

/** MPN 与缺口是最低限度 —— 没有它们这行没有意义 */
const REQUIRED: ShortageField[] = ["mpn", "shortageQty"];

export interface ParsedShortageLine {
  rowNo: number;
  customer: string | null;
  internalPn: string | null;
  manufacturer: string | null;
  mpn: string;
  requiredQty: string;
  availableInventory: string | null;
  openPoQty: string | null;
  supplier: string | null;
  eta: string | null;
  shortageQty: string;
  requiredDate: string | null;
}

export interface ShortageParseResult {
  lines: ParsedShortageLine[];
  errors: { row: number; message: string }[];
  notices: string[];
}

/** 数量类保留原始字符串给 Decimal;非法或为空返回 null(**不回落 0**) */
function numOrNull(v: string | undefined): string | null {
  const t = (v ?? "").trim().replace(/,/g, "");
  if (t === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return t;
}

/** 日期只接受能确定解析的形态,含糊的返回 null 而不是猜 */
function dateOrNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (!m) return null;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime()) ? null : iso;
}

export function parseShortageSheet(rawGrid: string[][]): ShortageParseResult {
  const grid = rawGrid.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (grid.length === 0) {
    return { lines: [], errors: [{ row: 0, message: "未能解析出表格" }], notices: [] };
  }

  const mapping = detectMapping<ShortageField>(grid, SYNONYMS, REQUIRED);
  const missing = missingFields(mapping, REQUIRED);
  if (missing.length > 0) {
    return {
      lines: [],
      errors: [
        {
          row: mapping.headerRowIndex + 1,
          message: `缺少必需列:${missing.map((f) => SHORTAGE_FIELD_LABEL[f]).join("、")}`,
        },
      ],
      notices: [],
    };
  }

  const errors: { row: number; message: string }[] = [];
  const notices: string[] = [];
  const lines: ParsedShortageLine[] = [];
  const cell = (row: string[], f: ShortageField) => {
    const i = mapping.fields[f];
    return i === undefined ? undefined : row[i];
  };

  if (mapping.fields.supplier === undefined) {
    notices.push("未识别到「供应商」列 —— 缺料行不带供应商,Call 料时需人工指定");
  }

  for (let i = mapping.headerRowIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    const rowNo = i + 1;
    const mpn = (cell(row, "mpn") ?? "").trim();
    if (!mpn) {
      errors.push({ row: rowNo, message: "缺少 MPN" });
      continue;
    }
    const shortage = numOrNull(cell(row, "shortageQty"));
    if (shortage === null) {
      errors.push({ row: rowNo, message: "缺口数量必须是数字" });
      continue;
    }
    if (new Decimal(shortage).lte(0)) {
      // 缺口 ≤ 0 的行不是缺料 —— 报出来而不是静默丢,免得人以为导进去了
      errors.push({ row: rowNo, message: `缺口数量为 ${shortage},不是缺料行` });
      continue;
    }

    lines.push({
      rowNo,
      customer: (cell(row, "customer") ?? "").trim() || null,
      internalPn: (cell(row, "internalPn") ?? "").trim() || null,
      manufacturer: (cell(row, "manufacturer") ?? "").trim() || null,
      mpn,
      // 需求数量缺失时回落到缺口 —— 并在 notices 里说明,不静默
      requiredQty: numOrNull(cell(row, "requiredQty")) ?? shortage,
      availableInventory: numOrNull(cell(row, "availableInventory")),
      openPoQty: numOrNull(cell(row, "openPoQty")),
      supplier: (cell(row, "supplier") ?? "").trim() || null,
      eta: dateOrNull(cell(row, "eta")),
      shortageQty: shortage,
      requiredDate: dateOrNull(cell(row, "requiredDate")),
    });
  }

  if (lines.length === 0 && errors.length === 0) {
    errors.push({ row: mapping.headerRowIndex + 1, message: "表头之后没有数据行" });
  }
  const noRequired = lines.filter((l) => l.requiredQty === l.shortageQty).length;
  if (mapping.fields.requiredQty === undefined && noRequired > 0) {
    notices.push(`未识别到「需求数量」列 —— ${noRequired} 行按缺口数量填充,仅供参考`);
  }
  return { lines, errors, notices };
}

/* ============================================================
 * 状态机
 * ============================================================ */

export type ShortageStatus =
  | "OPEN"
  | "CALL_CREATED"
  | "SENT_TO_SUPPLIER"
  | "PARTIALLY_RESOLVED"
  | "RESOLVED";

export const SHORTAGE_STATUS_LABEL: Record<ShortageStatus, string> = {
  OPEN: "待处理",
  CALL_CREATED: "已建 Call 料",
  SENT_TO_SUPPLIER: "已发供应商",
  PARTIALLY_RESOLVED: "部分解决",
  RESOLVED: "已处理",
};

/**
 * 允许的流转 —— **单向,不设回退**。
 *
 * 缺料处理里的每一步都是对外承诺过的动作(建了 call 料、发了供应商)。
 * 允许退回上一状态,等于让"已经催过"这件事凭空消失,事后没人说得清
 * 到底催没催过。要撤销就新开一轮,不改历史。
 */
const TRANSITIONS: Record<ShortageStatus, ShortageStatus[]> = {
  OPEN: ["CALL_CREATED"],
  CALL_CREATED: ["SENT_TO_SUPPLIER", "PARTIALLY_RESOLVED", "RESOLVED"],
  SENT_TO_SUPPLIER: ["PARTIALLY_RESOLVED", "RESOLVED"],
  PARTIALLY_RESOLVED: ["RESOLVED"],
  RESOLVED: [],
};

export type TransitionCheck = { ok: true } | { ok: false; message: string };

export function checkShortageTransition(
  from: ShortageStatus,
  to: ShortageStatus,
): TransitionCheck {
  if (from === to) {
    return { ok: false, message: `已处于「${SHORTAGE_STATUS_LABEL[to]}」` };
  }
  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      message:
        from === "RESOLVED"
          ? "「已处理」是终态,不可再流转 —— 如需继续处理请新开一轮缺料单"
          : `不允许从「${SHORTAGE_STATUS_LABEL[from]}」直接到「${SHORTAGE_STATUS_LABEL[to]}」`,
    };
  }
  return { ok: true };
}

/** Call 料数量校验:必须为正,且不得超过缺口 */
export function checkCallQty(callQty: string, shortageQty: string): TransitionCheck {
  let q: Decimal;
  try {
    q = new Decimal(callQty);
  } catch {
    return { ok: false, message: "Call 料数量必须是数字" };
  }
  if (!q.isFinite() || q.lte(0)) return { ok: false, message: "Call 料数量必须大于 0" };
  if (q.gt(new Decimal(shortageQty))) {
    return {
      ok: false,
      message: `Call 料数量 ${callQty} 超过缺口 ${shortageQty} —— 多要的部分不在这张缺料单的范围内`,
    };
  }
  return { ok: true };
}
