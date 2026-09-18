/**
 * REF-2c:BOM 标准化管线的数据类型。
 *
 * 从 lib/domain/bom-parse.ts 原样迁来(bom-parse 继续转出,调用方无感);
 * V1(bom-parse `buildLines`)与 V2(本目录 pipeline.ts)共用同一套类型,
 * 对拍才有意义。
 */

/** 标准 BOM 行字段(与 Prisma BOMLine 对齐) */
export type BomField =
  | "refDes"
  | "qty"
  | "mpn"
  | "manufacturer"
  | "customerPn"
  | "internalPn"
  | "description"
  | "footprint";

/** MPN 的来源:来自独立列,还是从 Value 推断出来的(推断的必须人工确认) */
export type MpnSource = "column" | "inferred-from-value";

export interface ParsedBomLine {
  /** 源文件行号(1 基,含表头行,便于人工回原表定位) */
  sourceRow: number;
  lineNo: number;
  refDes: string | null;
  qty: number | null;
  mpn: string | null;
  manufacturer: string | null;
  customerPn: string | null;
  internalPn: string | null;
  description: string | null;
  footprint: string | null;
  /** MPN 来源;缺省/为 null 表示本行没有 MPN(可选:旧调用点无需构造) */
  mpnSource?: MpnSource | null;
  /** 从封装串归一出的封装代码(如 0603 / SOT-23-5 / QFN-32),取不出为 null */
  packageCode?: string | null;
  /** 本行解析问题(数量非法等) */
  issues: string[];
  /** 本行的提示(不是错误):如 MPN 由 Value 推断,需人工确认 */
  notices?: string[];
}

/**
 * 一行原始数据的**去向**(E1a / 客户 Q13:「AI 无法全部识别,数据会丢失」)。
 *
 * 在此之前,解析器用 5 个 `continue` 悄悄丢行:空行、翻页表头、续行、
 * 没有料号的行、只有位号的行 —— 每一条都有它的道理,但**没有一条留下痕迹**。
 * 于是 100 行进去、92 行出来,没人说得清另外 8 行去哪了。
 *
 * 现在每一行都必须落到下面某一个取值上,一行不许没有去向。
 * 这不是把丢弃改成不丢弃 —— 空行确实不该变成物料 ——
 * 而是**把"我丢了它、以及为什么"写下来**,让人能复核。
 */
export type RowDisposition =
  /** 成为一条 BOM 行 */
  | "RECOGNIZED"
  /** 续行/折行,内容并入上一行(位号、描述、封装) */
  | "MERGED_INTO_PREVIOUS"
  /** 整行为空 */
  | "BLANK"
  /** 翻页重复表头 */
  | "REPEATED_HEADER"
  /** 页脚(Page 1 of 3 这类) */
  | "PAGE_FOOTER"
  /** 既没有任何料号也没有位号 —— 不能当物料,但**需要人看一眼** */
  | "NO_IDENTIFIER"
  /** 只有位号、其它列全空 —— 多半是附注,但**需要人看一眼** */
  | "INSUFFICIENT";

export const DISPOSITION_LABEL: Record<RowDisposition, string> = {
  RECOGNIZED: "已识别为物料行",
  MERGED_INTO_PREVIOUS: "并入上一行(折行)",
  BLANK: "空行",
  REPEATED_HEADER: "重复表头",
  PAGE_FOOTER: "页脚",
  NO_IDENTIFIER: "无料号也无位号 —— 待人工判断",
  INSUFFICIENT: "仅有位号 —— 待人工判断",
};

/** 需要人工看一眼的去向:这些行**没有**变成物料,但也不能当成理所当然的垃圾 */
export const NEEDS_REVIEW_DISPOSITIONS: RowDisposition[] = ["NO_IDENTIFIER", "INSUFFICIENT"];

/** 确定为非业务内容的去向:可以安全略过,但仍然计数 */
export const NON_BUSINESS_DISPOSITIONS: RowDisposition[] = ["BLANK", "REPEATED_HEADER", "PAGE_FOOTER"];

/** 一行原始数据的去向记录 —— 与 RawBomRow 表一一对应 */
export interface RowTrace {
  /** 源文件行号(1 基,与 ParsedBomLine.sourceRow 同一口径) */
  sourceRow: number;
  disposition: RowDisposition;
  /** 人话原因,直接显示给用户 */
  reason: string;
  /** 成为了第几条 BOM 行(仅 RECOGNIZED) */
  lineNo: number | null;
  /** 并进了哪一行(仅 MERGED_INTO_PREVIOUS) */
  mergedIntoSourceRow: number | null;
  /** 原始单元格,便于人在界面上核对"这一行长什么样" */
  cells: string[];
}
