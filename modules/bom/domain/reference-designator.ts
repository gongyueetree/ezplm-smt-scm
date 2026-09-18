/**
 * REF-2:全系统唯一的位号(Reference Designator)解析。
 *
 * 现状(REF-0 审计 DUPLICATION_MATRIX §D3):4 处各自分词 ——
 *   C1 bom-validate.expandRefDes   真正展开范围
 *   C2 bom-parse.countRefDes       **只数 token,不展开范围**
 *   C3 bom-parse.looksLikeRefDesList
 *   C4 kicad-value.refDesClass
 *
 * C1 与 C2 对 `R1-R10` 一个给 10、一个给 1,而 C2 驱动续行合并的自校准。
 * 实测后果(见 tests/golden/bom/range-refdes):同一文件里只要还有真正的 PDF 折行,
 * 自校准就会选"合并模式",随后一条独立的 `TP1` 会被**错误并入** `R1-R10`,
 * 作为物料行静默消失 —— 而账本照样平衡,因为它如实记录了那个错误的合并决定。
 *
 * 规则采纳自 bom2buy `lib/bom/references.ts`(只采规则,实现重写),
 * 但**两处刻意不照搬**:
 * 1. **不去重** —— bom2buy 按大小写不敏感去重,而本仓的重复位号检测
 *    (detectDuplicateRefDes)正是要**看见**重复,去重会让它永远报不出来;
 * 2. **跨度上限沿用本仓 10000**,不改成 bom2buy 的 500 ——
 *    改上限会让 R1-R999 这类大板写法从"展开"变成"不展开",是行为变化而非修 bug。
 *
 * 与 bom2buy 一致的纪律:**原始串必须保留**(导出给客户时要用他们写的形式),
 * 展开结果另存;无法可靠展开的**不猜**,原样计为一个位号并登记到 unparsed。
 */

/**
 * 分隔符:半角逗号、**全角逗号 U+FF0C**、顿号 U+3001、半角分号、**全角分号 U+FF1B**、空白。
 *
 * ⚠️ 全角字符**一律用 \u 转义**写,不直接敲字面量 —— 教训来自旧实现:
 * bom-parse 的 `[,,;;\s]` 本意显然是"半角+全角"成对,但字节级核查发现
 * 两对**全是 ASCII**,全角逗号与全角分号从来没被处理过;
 * 在编辑器里肉眼根本看不出来。转义写法让这种错误不可能再发生。
 */
const SEPARATORS = /[,\uFF0C\u3001;\uFF1B\s]+/;

/**
 * 范围 token:`R1-R10` / `R1~R10` / 连接号 U+2013 / 破折号 U+2014 / 全角波浪 U+FF5E /
 * 省略号 U+2026 / `R1-10`(非 ASCII 同样一律转义书写,理由同上)。
 * 结束端前缀可省略(`R1-10`)。
 */
const RANGE = /^([A-Za-z_]+)(\d+)\s*[-~\u2013\u2014\uFF5E\u2026]\s*([A-Za-z_]*)(\d+)$/;

/** 范围展开的跨度上限(沿用本仓既有值;超限不展开、登记 unparsed) */
export const MAX_RANGE_SPAN = 10_000;

export interface ParsedReferences {
  /**
   * 展开后的位号(大写,**保留重复**,保持原顺序)。
   * 无法展开的 token 原样(大写)计入 —— 与既有 expandRefDes 语义一致,
   * 保证"位号个数"口径不因本模块而变。
   */
  refs: string[];
  /** 原始串,原样 */
  original: string;
  /** 被成功展开的范围 token(原样) */
  expandedRanges: string[];
  /**
   * 看起来像范围、但**没有展开**的 token(前缀不一致 / 反向 / 超跨度)。
   * 这些仍按 1 个位号计入 refs,但要让人看见:它们可能是原表笔误。
   */
  unparsed: string[];
}

export function parseReferences(raw: string | null | undefined): ParsedReferences {
  const original = raw ?? "";
  const refs: string[] = [];
  const expandedRanges: string[] = [];
  const unparsed: string[] = [];

  const tokens = original
    .split(SEPARATORS)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const m = token.match(RANGE);
    if (!m) {
      refs.push(token.toUpperCase());
      continue;
    }
    const [, prefix, startStr, endPrefix, endStr] = m;
    const start = Number(startStr);
    const end = Number(endStr);
    const prefixOk = !endPrefix || endPrefix.toUpperCase() === prefix.toUpperCase();
    // 反向(R10-R1)、前缀不一致(R1-C5)、超跨度:都不猜,原样计 1 个并登记
    if (!prefixOk || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > MAX_RANGE_SPAN) {
      refs.push(token.toUpperCase());
      unparsed.push(token);
      continue;
    }
    const p = prefix.toUpperCase();
    for (let n = start; n <= end; n++) refs.push(`${p}${n}`);
    expandedRanges.push(token);
  }

  return { refs, original, expandedRanges, unparsed };
}

/** 位号个数(**展开范围后**)。续行合并与"位号数 == 数量"校验都用它 */
export function referenceCount(raw: string | null | undefined): number {
  return parseReferences(raw).refs.length;
}

/**
 * 文本是否是一串位号(用于识别 PDF 里折行的位号续行)。
 *
 * 每个 token 都必须形如「字母开头 + 含数字」(R1 / C101 / U2A / !PCB700 / SH-J700),
 * 或是一个可识别的范围 —— 这样"备注:以上为主料"这类散文不会被当成位号。
 *
 * 相对旧实现(bom-parse.looksLikeRefDesList)的两处扩展,均为修正:
 * - 空格分隔的续行(`C3 C4`)此前**整串当一个 token**,因含空格被判"不是位号串",
 *   导致折行位号不被合并、位号被截断(文件头注释里 TI 那种 qty=12 只剩 2 个的情况);
 * - 用 `~` / 全角分隔的范围续行(`R11~R20`)此前同样认不出。
 */
export function looksLikeReferenceList(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const tokens = t.split(SEPARATORS).map((x) => x.trim()).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((x) => RANGE.test(x) || /^!?[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*$/.test(x));
}

/**
 * 把位号列表折回紧凑形式:同前缀连号 ≥3 个合成 `R1-R5`,恰好 2 个分开写。
 * 用于展示与导出;**不用于任何匹配**(匹配一律用展开后的 refs)。
 */
export function compactReferences(refs: readonly string[]): string {
  const parsed: { prefix: string; n: number }[] = [];
  const rest: string[] = [];
  for (const r of refs) {
    const m = r.match(/^([A-Za-z_]+)(\d+)$/);
    if (m) parsed.push({ prefix: m[1].toUpperCase(), n: Number(m[2]) });
    else rest.push(r);
  }

  const byPrefix = new Map<string, number[]>();
  for (const { prefix, n } of parsed) {
    const list = byPrefix.get(prefix) ?? [];
    if (!list.includes(n)) list.push(n);
    byPrefix.set(prefix, list);
  }

  const out: string[] = [];
  for (const prefix of [...byPrefix.keys()].sort()) {
    const nums = byPrefix.get(prefix)!.sort((a, b) => a - b);
    let i = 0;
    while (i < nums.length) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      const runLen = j - i + 1;
      if (runLen >= 3) out.push(`${prefix}${nums[i]}-${prefix}${nums[j]}`);
      else for (let k = i; k <= j; k++) out.push(`${prefix}${nums[k]}`);
      i = j + 1;
    }
  }
  return [...out, ...rest].join(",");
}
