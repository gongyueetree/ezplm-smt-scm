/**
 * 参数值解析与逐项比对(纯函数,可完全单测)。
 *
 * 替代料判定的核心不是"型号像不像",而是**逐个参数够不够用**:
 * - 主频 72MHz 的位置换上 108MHz 通常没问题,但换上 48MHz 就是欠配;
 * - 工作电压 2.0–3.6V 的位置换上 2.6–3.6V,低端覆盖不住,属**部分覆盖**;
 * - 接口 UART×3 的位置换上 UART×2,少一路就是缺。
 *
 * 纪律:
 * - 解析不出来一律 UNKNOWN,**不猜**也不按 0 分处理(未知 ≠ 不满足);
 * - 数值方向有意义:能力更高不等于不合格,但也不等于完全等价,要分开表述;
 * - 只给结论与依据,**不做替换决定** —— 那是工程的事。
 */

export type ParamKind = "number" | "range" | "text" | "list";

export interface ParsedParam {
  kind: ParamKind;
  /** number:数值;range:[min,max];list:归一后的条目;text:归一文本 */
  number?: number;
  range?: [number, number];
  list?: string[];
  text?: string;
  /** 单位(有则记录,仅用于展示与同量纲校验) */
  unit?: string;
  raw: string;
}

/** 判定结论 */
export type ParamVerdict = "一致" | "更优" | "部分覆盖" | "有差异" | "缺失" | "未知" | "不可比";

export interface ParamComparison {
  /** 0–100;未知时为 null(不能当 0 参与加权) */
  score: number | null;
  verdict: ParamVerdict;
  detail: string;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

/**
 * R0-2:单位允许出现的字符。
 * 必须含欧姆符号 —— 此前字符类里没有它,`100 mΩ` 解析失败后落进文本分支,
 * 变成"字符串相等给 100,否则 0",电阻类参数实际上从未被数值比较过。
 * Ω 有两个常见码位:U+03A9(希腊大写)与 U+2126(欧姆符号),都要认。
 */
const UNIT_CHARS = "a-zA-Z\u00b5\u03bc%\u00b0\u03a9\u2126";

/** 数量级前缀 → 倍率(用于 KB/MB、kHz/MHz 之间的换算) */
const SCALE: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12,
};

/** 归一:全角转半角、去多余空白、统一大小写用于文本比较 */
function normalizeRaw(raw: string): string {
  return raw
    .replace(/[０-９Ａ-Ｚａ-ｚ．－～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[~～]/g, "~")
    .replace(/\s+/g, " ")
    .trim();
}

/** 拆出「数值 + 单位」,并把量纲前缀折算进数值 */
function parseMagnitude(token: string): { value: number; unit: string } | null {
  const m = token.match(new RegExp(`^(${NUM})\\s*([${UNIT_CHARS}]*)$`));
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const rawUnit = m[2] ?? "";
  if (!rawUnit) return { value, unit: "" };

  // 前缀只有在后面还跟着单位时才算前缀(K in "KB");单独的 "K" 视为无单位倍率
  const head = rawUnit[0];
  if (SCALE[head] !== undefined && rawUnit.length >= 1) {
    const rest = rawUnit.slice(1);
    // "mA" 里的 m 是前缀;"m" 单独出现(米)不折算 —— 元器件参数里基本不会出现米
    if (rest.length > 0 || head === "K" || head === "k" || head === "M" || head === "G") {
      return { value: value * SCALE[head], unit: rest.toUpperCase() };
    }
  }
  return { value, unit: rawUnit.toUpperCase() };
}

/**
 * 解析参数值。
 * 支持:`72 MHz` `64 KB` `37` `2.0 to 3.6 V` `-40~85°C` `UART×3, SPI×2, CAN`
 */
export function parseParamValue(raw: string | null | undefined): ParsedParam | null {
  const text = normalizeRaw(raw ?? "");
  if (!text) return null;

  // 区间:a to b / a~b / a - b(带可选统一单位)
  const rangeMatch = text.match(
    new RegExp(`^(${NUM})\\s*(?:to|~|至|-)\\s*(${NUM})\\s*([${UNIT_CHARS}]*)$`, "i"),
  );
  if (rangeMatch) {
    const unit = rangeMatch[3] ?? "";
    const lo = parseMagnitude(`${rangeMatch[1]}${unit}`);
    const hi = parseMagnitude(`${rangeMatch[2]}${unit}`);
    if (lo && hi) {
      return {
        kind: "range",
        range: [Math.min(lo.value, hi.value), Math.max(lo.value, hi.value)],
        unit: lo.unit,
        raw: text,
      };
    }
  }

  // 列表:含逗号/顿号分隔的多项
  if (/[,、;;]/.test(text)) {
    const list = text
      .split(/[,、;;]/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    if (list.length > 1) return { kind: "list", list, raw: text };
  }

  const single = parseMagnitude(text);
  if (single) {
    return { kind: "number", number: single.value, unit: single.unit, raw: text };
  }

  return { kind: "text", text: text.toUpperCase(), raw: text };
}

/** 列表项拆成「名称 + 路数」:`UART×3` → { name: UART, count: 3 } */
function splitListItem(item: string): { name: string; count: number } {
  const m = item.match(/^(.*?)\s*[×xX*]\s*(\d+)$/);
  if (m) return { name: m[1].trim(), count: Number(m[2]) };
  return { name: item.trim(), count: 1 };
}

/** 数值偏差 → 分数:相对偏差越大分越低 */
function numericScore(required: number, actual: number): number {
  if (required === actual) return 100;
  const base = Math.max(Math.abs(required), 1e-9);
  const deviation = Math.abs(actual - required) / base;
  return Math.max(0, Math.round(100 * (1 - Math.min(deviation, 1))));
}

/**
 * 比对一个参数。
 *
 * @param higherIsBetter 该参数是否"越大越好"(主频/Flash/SRAM/GPIO 是,封装/内核不是)。
 *   为 true 时,候选值不低于要求即判**更优**而不是有差异。
 */
export function compareParam(
  requiredRaw: string | null | undefined,
  actualRaw: string | null | undefined,
  options: { higherIsBetter?: boolean } = {},
): ParamComparison {
  const required = parseParamValue(requiredRaw);
  const actual = parseParamValue(actualRaw);

  if (!required) return { score: null, verdict: "未知", detail: "原型号未给出该参数,无法比对" };
  if (!actual) return { score: null, verdict: "缺失", detail: "候选未提供该参数" };

  /*
   * R0-2:量纲不同 → **拒绝比较**,而不是比数值。
   *
   * 量纲前缀在解析时已折算进数值,于是 `72 MHz` 与 `72 MB` 都变成 72e6,
   * 旧实现只读 .number,把它们判成「一致 / 100 分」。ParsedParam.unit 一直存着
   * 单位,却没有任何调用点读过它。
   *
   * 口径**刻意保守**:只有两侧都标了单位且不同才判不可比;
   * 一侧没标单位时仍按数值比 —— 本仓库的参数数据经常只在一侧带单位,
   * 一律判不可比会把大量本来有效的比较打成未知(宁可少判,不可错判)。
   * 严格的 QuantityIR(按量纲分类而非按单位字符串)属 REF-4。
   */
  const ru = required.unit ?? "";
  const au = actual.unit ?? "";
  if (ru !== "" && au !== "" && ru !== au) {
    return {
      score: null,
      verdict: "不可比",
      detail: `量纲不同(${ru} vs ${au}),不做数值比较 —— 需人工确认参数口径`,
    };
  }

  if (required.kind === "range" && actual.kind === "range") {
    const [rl, rh] = required.range!;
    const [al, ah] = actual.range!;
    if (al <= rl && ah >= rh) {
      return { score: 100, verdict: "一致", detail: `候选区间 ${actual.raw} 完全覆盖要求 ${required.raw}` };
    }
    const overlap = Math.max(0, Math.min(rh, ah) - Math.max(rl, al));
    const span = rh - rl;
    if (overlap <= 0) {
      return { score: 0, verdict: "有差异", detail: `候选区间 ${actual.raw} 与要求 ${required.raw} 无重叠` };
    }
    const ratio = span === 0 ? 1 : overlap / span;
    return {
      score: Math.round(ratio * 100),
      verdict: "部分覆盖",
      detail: `候选区间 ${actual.raw} 只覆盖要求 ${required.raw} 的 ${Math.round(ratio * 100)}%`,
    };
  }

  if (required.kind === "number" && actual.kind === "number") {
    const r = required.number!;
    const a = actual.number!;
    if (r === a) return { score: 100, verdict: "一致", detail: `与要求一致(${actual.raw})` };
    if (options.higherIsBetter && a > r) {
      return { score: 100, verdict: "更优", detail: `${actual.raw} 高于要求 ${required.raw},满足且有余量` };
    }
    const score = numericScore(r, a);
    return {
      score,
      verdict: "有差异",
      detail:
        options.higherIsBetter && a < r
          ? `${actual.raw} 低于要求 ${required.raw},存在欠配风险`
          : `${actual.raw} 与要求 ${required.raw} 不同`,
    };
  }

  if (required.kind === "list" && actual.kind === "list") {
    const need = required.list!.map(splitListItem);
    const have = new Map(actual.list!.map(splitListItem).map((x) => [x.name, x.count]));
    let satisfied = 0;
    const missing: string[] = [];
    for (const n of need) {
      const got = have.get(n.name);
      if (got !== undefined && got >= n.count) satisfied += 1;
      else missing.push(got === undefined ? n.name : `${n.name}(需${n.count}实${got})`);
    }
    const ratio = need.length === 0 ? 1 : satisfied / need.length;
    if (ratio === 1) return { score: 100, verdict: "一致", detail: "所需接口全部具备" };
    return {
      score: Math.round(ratio * 100),
      verdict: ratio > 0 ? "部分覆盖" : "有差异",
      detail: `缺少:${missing.join("、")}`,
    };
  }

  // 文本/枚举,或两边类型不同:只认完全一致
  const r = required.text ?? required.raw.toUpperCase();
  const a = actual.text ?? actual.raw.toUpperCase();
  if (r === a) return { score: 100, verdict: "一致", detail: `与要求一致(${actual.raw})` };
  return { score: 0, verdict: "有差异", detail: `候选为 ${actual.raw},要求为 ${required.raw}` };
}

/**
 * 参数名匹配。
 *
 * ezPLM 里同族物料的属性命名并不统一 ——
 * 同一个概念可能叫 `SRAM容量 - 数据存储器容量 (KB)`,也可能只叫 `SRAM容量`。
 * 按字符串全等去对,参数就永远对不上,证据覆盖恒为 0。
 *
 * 做法:取「说明性后缀之前的主名」再比,并允许一方包含另一方。
 * 仍然要求主名有实质重合,**不做模糊猜测**(否则"工作温度"会去匹配"工作电压")。
 */
export function paramNameHead(name: string): string {
  return name
    .normalize("NFKC")
    .split(/\s+[-—–]\s+/)[0]
    .replace(/[((].*?[))]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

export function matchParamName(constraintLabel: string, candidateName: string): boolean {
  const a = paramNameHead(constraintLabel);
  const b = paramNameHead(candidateName);
  if (!a || !b) return false;
  if (a === b) return true;
  // 允许一方是另一方的前缀/包含,但要求较短的一方至少 2 个字符,避免"电"匹配一切
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 2 && longer.includes(shorter);
}
