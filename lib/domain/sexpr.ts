/**
 * KiCad 文件(.kicad_sym / .kicad_mod)使用的 S-表达式解析器。
 *
 * 只做「文本 → 树」这一件事,不理解任何 KiCad 语义 ——
 * 语义解释放在 kicad-symbol.ts / kicad-footprint.ts,便于分别单测。
 *
 * 纪律:解析失败一律抛出带位置的错误,**绝不返回半截结果**;
 * 半截的几何画出来就是错误的封装图,比不画更危险。
 */

export type SNode = string | SList;
export interface SList {
  /** 列表首项(如 "footprint" / "pad"),首项不是原子时为 null */
  head: string | null;
  items: SNode[];
}

export function isList(n: SNode): n is SList {
  return typeof n !== "string";
}

class Cursor {
  constructor(
    readonly src: string,
    public i = 0,
  ) {}
  fail(msg: string): never {
    const line = this.src.slice(0, this.i).split("\n").length;
    throw new Error(`S-表达式解析失败(第 ${line} 行,偏移 ${this.i}):${msg}`);
  }
}

function skipWs(c: Cursor) {
  while (c.i < c.src.length) {
    const ch = c.src[c.i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      c.i++;
    } else if (ch === "#" || ch === ";") {
      // KiCad 不产出注释,但容忍之
      while (c.i < c.src.length && c.src[c.i] !== "\n") c.i++;
    } else {
      return;
    }
  }
}

function readQuoted(c: Cursor): string {
  c.i++; // 跳过起始引号
  let out = "";
  while (c.i < c.src.length) {
    const ch = c.src[c.i];
    if (ch === "\\") {
      const next = c.src[c.i + 1];
      if (next === undefined) c.fail("字符串以转义符结尾");
      out += next === "n" ? "\n" : next === "t" ? "\t" : next;
      c.i += 2;
      continue;
    }
    if (ch === '"') {
      c.i++;
      return out;
    }
    out += ch;
    c.i++;
  }
  c.fail("字符串未闭合");
}

function readAtom(c: Cursor): string {
  const start = c.i;
  while (c.i < c.src.length && !' \t\n\r()"'.includes(c.src[c.i])) c.i++;
  if (c.i === start) c.fail(`无法识别的字符 ${JSON.stringify(c.src[c.i])}`);
  return c.src.slice(start, c.i);
}

function readNode(c: Cursor): SNode {
  skipWs(c);
  if (c.i >= c.src.length) c.fail("内容意外结束");
  const ch = c.src[c.i];
  if (ch === "(") {
    c.i++;
    const items: SNode[] = [];
    for (;;) {
      skipWs(c);
      if (c.i >= c.src.length) c.fail("列表未闭合");
      if (c.src[c.i] === ")") {
        c.i++;
        break;
      }
      items.push(readNode(c));
    }
    const first = items[0];
    return { head: typeof first === "string" ? first : null, items };
  }
  if (ch === '"') return readQuoted(c);
  if (ch === ")") c.fail("多余的右括号");
  return readAtom(c);
}

/** 解析整份文件,返回顶层列表(KiCad 文件顶层恒为单个列表) */
export function parseSexpr(src: string): SList {
  const c = new Cursor(src);
  const node = readNode(c);
  if (!isList(node)) throw new Error("S-表达式解析失败:顶层不是列表");
  skipWs(c);
  if (c.i !== c.src.length) c.fail("顶层列表之后仍有内容");
  return node;
}

/* ---------- 取值辅助 ---------- */

/** 直接子列表中 head 匹配的全部节点 */
export function children(node: SList, head: string): SList[] {
  return node.items.filter((n): n is SList => isList(n) && n.head === head);
}

/** 直接子列表中 head 匹配的第一个节点 */
export function child(node: SList, head: string): SList | null {
  return children(node, head)[0] ?? null;
}

/** 递归查找所有 head 匹配的后代节点(含自身子树) */
export function descendants(node: SList, head: string): SList[] {
  const out: SList[] = [];
  const walk = (n: SList) => {
    for (const item of n.items) {
      if (!isList(item)) continue;
      if (item.head === head) out.push(item);
      walk(item);
    }
  };
  walk(node);
  return out;
}

/** 取第 idx 个原子项(0 为 head 本身) */
export function atom(node: SList | null, idx: number): string | null {
  if (!node) return null;
  const v = node.items[idx];
  return typeof v === "string" ? v : null;
}

/** 取第 idx 个原子项并转数字;非有限数返回 null(不落 0 —— 0 是合法坐标) */
export function num(node: SList | null, idx: number): number | null {
  const s = atom(node, idx);
  if (s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** 读取 (xxx x y [angle]) 形式的坐标 */
export function xy(node: SList | null): { x: number; y: number; angle: number } | null {
  const x = num(node, 1);
  const y = num(node, 2);
  if (x === null || y === null) return null;
  return { x, y, angle: num(node, 3) ?? 0 };
}
