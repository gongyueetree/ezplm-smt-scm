import {
  cellText,
  detectVocabularyMapping,
  missingFields,
  type MappingResult,
  type ColumnVocabulary,
} from "@/modules/tabular/domain/column-mapping";
import { BOM_VOCABULARY } from "@/modules/tabular/vocabularies/bom";
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";
import { inferMpnFromValue, parseKicadFootprint } from "./kicad-value";
import { looksLikeReferenceList, referenceCount } from "@/modules/bom/domain/reference-designator";
import {
  type BomField,
  type MpnSource,
  type ParsedBomLine,
  type RowDisposition,
  type RowTrace,
} from "@/modules/bom/domain/normalizer/types";
import { isPageFooter, looksLikeMpnCell, parseQty } from "@/modules/bom/domain/normalizer/cells";
import { normalizeBom } from "@/modules/bom/domain/normalizer/pipeline";
import { isRefactorFlagOn } from "./refactor-flags";

// REF-2c:类型、单元格规则与账本迁到 modules/bom/domain/normalizer/,此处原样转出
export {
  DISPOSITION_LABEL,
  NEEDS_REVIEW_DISPOSITIONS,
  NON_BUSINESS_DISPOSITIONS,
  type BomField,
  type MpnSource,
  type ParsedBomLine,
  type RowDisposition,
  type RowTrace,
} from "@/modules/bom/domain/normalizer/types";
export { isPageFooter, looksLikeMpnCell, parseQty } from "@/modules/bom/domain/normalizer/cells";
export { reconcileImport, type ImportReconciliation } from "@/modules/bom/domain/normalizer/ledger";

/**
 * BOM 列映射与标准化(SPEC §6:列映射、非标准 BOM 转标准结构)。
 *
 * 纪律:
 * - 自动识别只产出「建议映射 + 置信度」,人工可覆盖;不确定的列一律留空而不是猜。
 * - 数量解析失败不静默填 1 —— 记 issue,由人工处理(错误的用量会一路错到报价)。
 */

export const BOM_FIELD_LABELS: Record<BomField, string> = {
  refDes: "位号",
  qty: "数量",
  mpn: "制造商料号 MPN",
  manufacturer: "制造商",
  customerPn: "客户料号",
  internalPn: "内部料号",
  description: "描述",
  footprint: "封装",
};

/** 列词表是数据:modules/tabular/vocabularies/bom.ts(含「料号」口径与客户料号限定词规则) */
const VOCABULARY: ColumnVocabulary<BomField> = BOM_VOCABULARY;

export type ColumnMapping = MappingResult<BomField>;

/**
 * 关键字段:缺它就无法形成 BOM 行。
 *
 * 只强制 qty —— 大量工程侧 BOM(KiCad/Altium 直接导出)只有
 * 位号 / 数量 / Value / 封装,**根本没有 MPN 列**。
 * 把 MPN 也设为必填会让这类文件直接 422 被拒之门外;
 * 正确做法是让它进来,再由校验逐行提示"缺 MPN,无法匹配与比价"。
 */
const REQUIRED_FIELDS = VOCABULARY.required;

/** 强烈建议但不强制的字段:缺了会在导入结果里明确提示 */
export const RECOMMENDED_FIELDS: BomField[] = ["mpn"];

/** 缺失的建议字段(用于 UI 提示,不阻断导入) */
export function missingRecommendedFields(mapping: ColumnMapping): BomField[] {
  return RECOMMENDED_FIELDS.filter((f) => mapping.fields[f] === undefined);
}

/**
 * 检测表头行并生成建议映射(委托通用引擎 modules/tabular/domain/column-mapping.ts)。
 * 非标准 BOM 常见前几行是标题/客户信息,故在前 maxScanRows 行中选"识别字段最多"的一行。
 */
export function detectColumnMapping(rows: string[][], maxScanRows = 10): ColumnMapping {
  return detectVocabularyMapping(rows, VOCABULARY, maxScanRows);
}

/** 映射是否可用于导入 */
export function isMappingUsable(mapping: ColumnMapping): boolean {
  return REQUIRED_FIELDS.every((f) => mapping.fields[f] !== undefined);
}

export function missingRequiredFields(mapping: ColumnMapping): BomField[] {
  return missingFields(mapping, REQUIRED_FIELDS);
}

/**
 * 文本是否是一串位号(如 `C103, C201, C202,`)。
 *
 * 用于识别 PDF 里**换行的位号列表**:一格装不下时会折到下一行,
 * 表格重建后表现为"只有位号列有值、其余全空"的行。
 * 必须与"备注:以上为主料"这类附注区分开 —— 后者是散文,不是位号串。
 */
export function looksLikeRefDesList(text: string | null | undefined): boolean {
  // REF-2a:转调 canonical。修正两处:空格分隔的续行(`C3 C4`)与 `~`/全角范围续行
  // 此前都认不出,导致折行位号不被合并、位号被截断。
  return looksLikeReferenceList(text);
}

/**
 * 数一行位号里有几个位号(**展开范围后**)。
 *
 * REF-2a 修正两个缺陷,二者都会让续行合并的判据"上一行位号数 < 数量"误判:
 * 1. 旧实现只数 token、**不展开范围**:`R1-R10` 算 1 个。同一文件里只要还有真正的
 *    PDF 折行、自校准选了"合并模式",随后一条独立的 `TP1` 就会被错误并入 `R1-R10`,
 *    作为物料行静默消失(账本照样平衡 —— 它如实记录了那个错误的合并);
 * 2. 旧分隔符 `[,,;;\s]` 本意是"半角+全角"成对,字节级核查发现**两对全是 ASCII**,
 *    全角逗号/分号从未被处理:`C1,C2`(全角)也算 1 个。
 * 回归见 tests/golden/bom/range-refdes 与 tests/unit/reference-designator.test.ts。
 */
export function countRefDes(refDes: string | null | undefined): number {
  return referenceCount(refDes);
}

/**
 * 按映射把原始行转为标准 BOM 行(非标准 BOM → 标准结构)。
 *
 * @deprecated REF-2c:V1 实现,原样保留作对拍基准;V2 见 modules/bom/domain/normalizer/pipeline.ts。
 * flag 翻转且对拍持续零差异后,与 `refDesAgreement` 一并在 REF-10 删除。
 */
function buildLines(
  rows: string[][],
  mapping: ColumnMapping,
  mergeContinuations: boolean,
): { lines: ParsedBomLine[]; trace: RowTrace[] } {
  const out: ParsedBomLine[] = [];
  const trace: RowTrace[] = [];
  let lineNo = 0;

  const mark = (
    r: number,
    disposition: RowDisposition,
    reason: string,
    extra?: { lineNo?: number; mergedIntoSourceRow?: number },
  ) => {
    trace.push({
      sourceRow: r + 1,
      disposition,
      reason,
      lineNo: extra?.lineNo ?? null,
      mergedIntoSourceRow: extra?.mergedIntoSourceRow ?? null,
      cells: (rows[r] ?? []).map((c) => (c ?? "").trim()),
    });
  };

  const headerKey = (rows[mapping.headerRowIndex] ?? [])
    .map((c) => (c ?? "").trim().toUpperCase())
    .join("\u0001");

  for (let r = mapping.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => (c ?? "").trim() === "")) {
      mark(r, "BLANK", "整行没有任何内容");
      continue;
    }
    // 翻页重复表头:多页 PDF 每页都会重复一次表头,它不是数据行。
    // (buildPdfTable 只能与"第一行"比对,而表格上方常有标题块,
    //  真正的表头并不在第一行 —— 所以这里按识别出来的表头再挡一次。)
    if (
      row.map((c) => (c ?? "").trim().toUpperCase()).join("\u0001") === headerKey
    ) {
      mark(r, "REPEATED_HEADER", "与表头完全一致 —— 多页文件每页都会重复一次表头");
      continue;
    }

    const rawQty = cellText(row, mapping.fields.qty);
    const { qty, issue, notice: qtyNotice } = parseQty(rawQty);
    const mpnCell = cellText(row, mapping.fields.mpn);
    // 整段正文落进料号列时一律不当 MPN(见 looksLikeMpnCell)
    const mpn = looksLikeMpnCell(mpnCell) ? mpnCell : null;
    const customerPn = cellText(row, mapping.fields.customerPn);
    const internalPn = cellText(row, mapping.fields.internalPn);
    const description = cellText(row, mapping.fields.description);

    const refDes = cellText(row, mapping.fields.refDes);
    const footprint = cellText(row, mapping.fields.footprint);
    const manufacturer = cellText(row, mapping.fields.manufacturer);

    /*
     * 判断这一行是不是真的 BOM 行。
     *
     * - 有任一"物料标识"(MPN / 客户料号 / 内部料号 / 描述)→ 是;
     * - 只有位号 → **要看还有没有别的列有值**:
     *   工程侧 BOM(KiCad/Altium)常常只有 位号/数量/Value/封装,没有 MPN,
     *   不认位号就会把整张表当附注丢光(实测导出的 BOM 会解析出 0 行);
     *   但"备注:以上为主料"这种附注也会落在第一列,
     *   它的特征是**整行只有这一个格有值** —— 据此区分,不靠猜文案。
     */
    const hasIdentifier = Boolean(mpn || customerPn || internalPn || description);
    const otherFilled = [rawQty, manufacturer, footprint].filter(Boolean).length;

    /*
     * 续行合并:PDF 里一格装不下的位号列表会折行,
     * 表格重建后是"只有位号列有值"的行。它属于上一行,不是新物料 ——
     * 不合并的话位号会被截断(TI 的 BOM 里 qty=12 却只剩 2 个位号)。
     *
     * 关键判据是**上一行还差位号**:上一行声明 qty=12 但目前只列了 2 个,
     * 说明后面还有。这比"看起来像续行"可靠得多 ——
     * 工程 BOM 里确实存在"有位号有封装但没填数量"的独立行,
     * 只要上一行的位号已经凑够数,就不会把它误并进去。
     */
    const prev = out.length > 0 ? out[out.length - 1] : null;
    const prevExpectsMore =
      prev !== null &&
      prev.qty !== null &&
      countRefDes(prev.refDes) > 0 &&
      countRefDes(prev.refDes) < prev.qty;
    const isContinuation =
      mergeContinuations &&
      prev !== null &&
      prevExpectsMore &&
      qty === null &&
      !mpn &&
      !customerPn &&
      !internalPn &&
      !manufacturer &&
      Boolean(refDes) &&
      looksLikeRefDesList(refDes);
    if (isContinuation) {
      prev.refDes = [prev.refDes, refDes].filter(Boolean).join(" ");
      // 描述/封装也可能跟着折行,补进上一行的空位(不覆盖已有内容)
      if (description && !prev.description) prev.description = description;
      if (footprint && !prev.footprint) prev.footprint = footprint;
      mark(
        r,
        "MERGED_INTO_PREVIOUS",
        `位号折行,已并入第 ${prev.sourceRow} 行(该行数量 ${prev.qty},位号尚未列全)`,
        { mergedIntoSourceRow: prev.sourceRow },
      );
      continue;
    }

    /*
     * 一条 BOM 行至少要有**位号或某种料号**。只有描述的行不是物料行:
     * 多页 PDF 的页脚(Page 1 of 3)、以及被折行的描述片段都会长成那样。
     * 页脚直接丢弃;其余描述片段并回上一行的描述,避免白丢信息。
     */
    const hasKey = Boolean(mpn || customerPn || internalPn || refDes);
    if (!hasKey) {
      if (description && isPageFooter(description)) {
        mark(r, "PAGE_FOOTER", "识别为页脚(如 Page 1 of 3)");
      } else if (description && out.length > 0) {
        const last = out[out.length - 1];
        last.description = [last.description, description].filter(Boolean).join(" ");
        mark(r, "MERGED_INTO_PREVIOUS", `描述折行,已并入第 ${last.sourceRow} 行的描述`, {
          mergedIntoSourceRow: last.sourceRow,
        });
      } else {
        mark(r, "NO_IDENTIFIER", "既无 MPN / 客户料号 / 内部料号,也无位号 —— 无法判定是不是物料行");
      }
      continue;
    }
    if (!hasIdentifier && !(refDes && otherFilled > 0)) {
      mark(r, "INSUFFICIENT", "只有位号一列有值,其余全空 —— 更像附注而不是物料行");
      continue;
    }

    const issues: string[] = [];
    const notices: string[] = [];
    if (issue) issues.push(issue);
    if (qtyNotice) notices.push(qtyNotice);

    /*
     * 工程侧 BOM 没有 MPN 列时,尝试从 Value 里认出型号。
     *
     * KiCad 的 Value 对不同器件含义不同:无源件是参数(0.1uF/10k),
     * IC 则**就是型号**(CH340E/LPC824M201JHI33)。判据见 kicad-value.ts。
     * 推断结果标记来源,**必须人工确认** —— 猜错型号会一路错到询价与报价。
     */
    let finalMpn = mpn;
    let mpnSource: MpnSource | null = mpn ? "column" : null;
    if (!finalMpn) {
      const inferred = inferMpnFromValue({ value: description, refDes });
      if (inferred) {
        finalMpn = inferred.mpn;
        mpnSource = "inferred-from-value";
        notices.push(inferred.reason);
      }
    }

    if (!finalMpn && !customerPn && !internalPn) {
      issues.push("缺少 MPN / 客户料号 / 内部料号,无法匹配");
    }

    lineNo += 1;
    mark(r, "RECOGNIZED", "已识别为物料行", { lineNo });
    out.push({
      sourceRow: r + 1,
      lineNo,
      refDes,
      qty,
      mpn: finalMpn,
      manufacturer,
      customerPn,
      internalPn,
      description,
      footprint,
      mpnSource,
      packageCode: parseKicadFootprint(footprint)?.packageCode ?? null,
      issues,
      notices,
    });
  }

  return { lines: out, trace };
}

/** 唯一 MPN 数量(决定是否走 ImportJob 分批,SPEC §15) */
export function countUniqueMpns(lines: ParsedBomLine[]): number {
  const set = new Set<string>();
  for (const l of lines) {
    const key = normalizeMpnKey(l.mpn ?? l.internalPn ?? l.customerPn);
    if (key) set.add(key);
  }
  return set.size;
}

/**
 * 「位号数 == 数量」的吻合率。
 * 用它来客观判断某个解析选择是不是更接近原表,而不是靠猜。
 */
function refDesAgreement(lines: ParsedBomLine[]): number {
  const solid = lines.filter((l) => l.qty !== null && l.refDes);
  if (solid.length === 0) return 0;
  const hit = solid.filter((l) => countRefDes(l.refDes) === l.qty).length;
  return hit / solid.length;
}

/**
 * 按映射把原始行转为标准 BOM 行(非标准 BOM → 标准结构)。
 *
 * 续行合并是**自校准**的:PDF 折行的位号需要合并,但很多 BOM 的
 * 数量根本不等于位号数(一个位号用量 10 也很常见),
 * 那里合并就是错的。所以两种解析都算一遍,取「位号数 == 数量」吻合率更高的那个;
 * 打平时不合并 —— 不确定就别动原始数据。
 */
export function toStandardLines(rows: string[][], mapping: ColumnMapping): ParsedBomLine[] {
  return toStandardLinesTraced(rows, mapping).lines;
}

/**
 * 同上,但**连同每一行的去向一起返回**。
 *
 * 两种解析各自带自己的 trace:选了哪一种,就用哪一种的 trace ——
 * 否则界面上说"第 7 行并入了第 6 行",实际采用的却是不合并的那一版,
 * 对不上账比不给账更糟。
 */
export function toStandardLinesTraced(
  rows: string[][],
  mapping: ColumnMapping,
  impl: "v1" | "v2" = isRefactorFlagOn("BOM_NORMALIZER_V2") ? "v2" : "v1",
): { lines: ParsedBomLine[]; trace: RowTrace[] } {
  // REF-2c:`REFACTOR_BOM_NORMALIZER_V2=1` 时走拆分后的管线(输出应逐字段相同,
  // 由 tests/golden/bom-normalizer-v2.golden.test.ts 对拍证明);默认仍是 V1。
  if (impl === "v2") {
    const { lines, trace } = normalizeBom(rows, mapping);
    return { lines, trace };
  }
  const plain = buildLines(rows, mapping, false);
  const merged = buildLines(rows, mapping, true);
  return refDesAgreement(merged.lines) > refDesAgreement(plain.lines) ? merged : plain;
}
