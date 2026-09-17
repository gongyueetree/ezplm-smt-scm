/**
 * REF-0.8:Golden Master 对拍框架(纯函数 + 一个编排函数)。
 *
 * MIGRATION_PLAN §2 要求每个模块迁移时都走:
 *   旧实现 = 生产结果;新实现后台同时算;逐字段 diff;
 *   差异清零或逐条人工批准后才 flip flag;最后删旧。
 *
 * 之所以必须先有这个框架:`lib/server/repositories/` 38 个文件里 **35 个零单测**,
 * 整层的安全网只有 E2E。没有对拍,REF-1 之后那些会改变业务输出的重构
 * (Canonical Identity / BOM V2 / 替代料引擎 V2)根本没法按
 * "差异清零才切换"的规矩推进 —— 只能靠肉眼,而肉眼看不见 16K 行的差异。
 *
 * 三条硬纪律:
 * 1. **新实现永远不许影响生产**。它抛错、超时、返回垃圾,`shadowRun` 都只
 *    记录下来,返回的**永远是旧实现的结果**。反过来,旧实现抛错要原样抛出 ——
 *    那是真实故障,不能被对拍框架吞掉。
 * 2. **默认脱敏**。对拍跑在真实数据上,diff 里默认只有**字段路径与类型/长度**,
 *    不含值内容(R4 §4:真实行不得进日志/报告)。需要看值时显式 `redact: false`,
 *    且只在本地。
 * 3. **截断显式上报**。差异过多时截断,但必须带 `truncated` 与 `total` ——
 *    "看起来只有 200 处差异"和"其实有 20 万处"是两回事。
 */

export type DiffKind =
  /** 两边都有,值不同 */
  | "CHANGED"
  /** 旧有新无 */
  | "MISSING_IN_NEXT"
  /** 旧无新有 */
  | "EXTRA_IN_NEXT"
  /** 类型都变了(如 string → number) */
  | "TYPE_CHANGED";

export interface ValueDiff {
  /** 形如 `lines[3].mpn`;根节点为 `$` */
  path: string;
  kind: DiffKind;
  /** 脱敏模式下是「类型(长度)」摘要,否则是值本身 */
  old: string;
  next: string;
}

export interface DiffOptions {
  /** 默认 true:只输出类型/长度摘要,不输出值内容 */
  redact?: boolean;
  /** 差异条数上限,默认 200 */
  maxDiffs?: number;
}

export interface DiffReport {
  diffs: ValueDiff[];
  /** 实际发现的差异总数(可能大于 diffs.length) */
  total: number;
  truncated: boolean;
}

/** 脱敏摘要:只暴露类型与规模,不暴露内容 */
export function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return `array(${v.length})`;
  switch (typeof v) {
    case "string":
      return `string(${v.length})`;
    case "number":
      return Number.isInteger(v) ? "int" : "float";
    case "boolean":
      return "boolean";
    case "object":
      return `object(${Object.keys(v as object).length})`;
    default:
      return typeof v;
  }
}

function render(v: unknown, redact: boolean): string {
  if (redact) return describeValue(v);
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Date/Decimal 这类对象按其字符串形态比较,避免因实例不同而假阳性 */
function scalarKey(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && !Array.isArray(v) && !isPlainObject(v)) {
    return String(v);
  }
  return v;
}

/**
 * 深度逐字段比较。结果按 path 排序,保证**确定性**
 * (同一对输入必须给出完全一致的报告,否则对拍报告本身不可复现)。
 */
export function diffValues(oldValue: unknown, nextValue: unknown, opts: DiffOptions = {}): DiffReport {
  const redact = opts.redact !== false;
  const maxDiffs = opts.maxDiffs ?? 200;
  const found: ValueDiff[] = [];
  let total = 0;

  const push = (path: string, kind: DiffKind, a: unknown, b: unknown) => {
    total += 1;
    if (found.length < maxDiffs) {
      found.push({ path, kind, old: render(a, redact), next: render(b, redact) });
    }
  };

  const walk = (a: unknown, b: unknown, path: string) => {
    if (Object.is(a, b)) return;

    const ka = scalarKey(a);
    const kb = scalarKey(b);
    if (Object.is(ka, kb)) return;

    const aMissing = a === undefined;
    const bMissing = b === undefined;
    if (aMissing !== bMissing) {
      push(path, aMissing ? "EXTRA_IN_NEXT" : "MISSING_IN_NEXT", a, b);
      return;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) walk(a[i], b[i], `${path}[${i}]`);
      return;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      // 键集合取并集并排序 —— 保证遍历顺序与对象字面量书写顺序无关
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const k of keys) walk(a[k], b[k], path === "$" ? k : `${path}.${k}`);
      return;
    }

    const typeA = Array.isArray(a) ? "array" : typeof a;
    const typeB = Array.isArray(b) ? "array" : typeof b;
    push(path, typeA !== typeB ? "TYPE_CHANGED" : "CHANGED", a, b);
  };

  walk(oldValue, nextValue, "$");
  found.sort((x, y) => x.path.localeCompare(y.path) || x.kind.localeCompare(y.kind));
  return { diffs: found, total, truncated: total > found.length };
}

export type ShadowStatus =
  /** 新旧完全一致 —— 可以考虑 flip */
  | "MATCH"
  /** 有差异 —— 必须逐条归因或人工批准,**不得直接 flip** */
  | "DIFF"
  /** 新实现自己炸了 —— 生产不受影响,但这条更严重 */
  | "NEXT_FAILED";

export interface ShadowOptions<T> {
  /** 对拍标签,建议用「模块:用例」形式,进报告好聚合 */
  label: string;
  /** 生产实现:它的结果就是返回值;抛错原样抛出 */
  old: () => Promise<T> | T;
  /** 新实现:抛错只记录,绝不外溢 */
  next: () => Promise<T> | T;
  diff?: DiffOptions;
  /** 注入时钟,便于测试(默认 Date.now) */
  now?: () => number;
}

export interface ShadowOutcome<T> {
  label: string;
  status: ShadowStatus;
  /** **永远是旧实现的结果** */
  result: T;
  report: DiffReport | null;
  nextError: string | null;
  durationMs: { old: number; next: number | null };
}

/**
 * 跑一次对拍。
 *
 * 用法:生产调用点把原来的 `await oldImpl(x)` 换成
 * `(await shadowRun({ label, old: () => oldImpl(x), next: () => newImpl(x) })).result`。
 * 行为不变(返回的仍是旧结果),但每次调用都留下一条可聚合的差异记录。
 */
export async function shadowRun<T>(opts: ShadowOptions<T>): Promise<ShadowOutcome<T>> {
  const now = opts.now ?? Date.now;

  // 旧实现先跑,且**不做任何保护** —— 它抛错就是真实故障,必须原样抛给调用方
  const t0 = now();
  const result = await opts.old();
  const oldMs = now() - t0;

  let nextValue: T | undefined;
  let nextError: string | null = null;
  let nextMs: number | null = null;

  const t1 = now();
  try {
    nextValue = await opts.next();
    nextMs = now() - t1;
  } catch (e) {
    nextMs = now() - t1;
    nextError = e instanceof Error ? e.message : String(e);
  }

  if (nextError !== null) {
    return {
      label: opts.label,
      status: "NEXT_FAILED",
      result,
      report: null,
      nextError,
      durationMs: { old: oldMs, next: nextMs },
    };
  }

  const report = diffValues(result, nextValue, opts.diff);
  return {
    label: opts.label,
    status: report.total === 0 ? "MATCH" : "DIFF",
    result,
    report,
    nextError: null,
    durationMs: { old: oldMs, next: nextMs },
  };
}

export interface ShadowSummary {
  total: number;
  match: number;
  diff: number;
  nextFailed: number;
  /** 按 label 聚合的差异路径计数,用于回答"差异集中在哪几个字段" */
  topPaths: { path: string; count: number }[];
  /** 差异清零才可 flip(MIGRATION_PLAN §2) */
  readyToFlip: boolean;
}

/** 汇总多次对拍;这是 Compatibility Report 的数据底座 */
export function summarizeShadowRuns(
  outcomes: readonly ShadowOutcome<unknown>[],
  topN = 20,
): ShadowSummary {
  const counts = new Map<string, number>();
  let match = 0;
  let diff = 0;
  let nextFailed = 0;

  for (const o of outcomes) {
    if (o.status === "MATCH") match += 1;
    else if (o.status === "DIFF") diff += 1;
    else nextFailed += 1;
    for (const d of o.report?.diffs ?? []) {
      counts.set(d.path, (counts.get(d.path) ?? 0) + 1);
    }
  }

  const topPaths = [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, topN);

  return {
    total: outcomes.length,
    match,
    diff,
    nextFailed,
    topPaths,
    // 新实现炸了同样不能切 —— "没有差异"不等于"跑通了"
    readyToFlip: outcomes.length > 0 && diff === 0 && nextFailed === 0,
  };
}
