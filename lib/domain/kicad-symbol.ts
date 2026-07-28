/**
 * .kicad_sym(原理图符号库)→ 可在线显示的 SVG。
 *
 * 坐标系:KiCad 符号库 Y 轴向上,SVG Y 轴向下 → 渲染时整体翻转 Y。
 * 单位为 mm,直接当作 SVG 用户单位,靠 viewBox 缩放。
 *
 * 纪律:
 * - 只画**能确定解析**的图元;遇到不认识的图元跳过并计入 skipped,
 *   在 UI 上如实说明"有 N 个图元未渲染",不假装画全了;
 * - 不做美化推断(比如猜引脚名位置),画不出来就不画。
 */
import { atom, child, children, isList, num, parseSexpr, xy, type SList } from "./sexpr";

export interface SymbolPin {
  x: number;
  y: number;
  /** 0/90/180/270,指向引脚线**离开**符号体的方向 */
  angle: number;
  length: number;
  name: string;
  number: string;
  electricalType: string;
}

export type SymbolShape =
  | { kind: "rect"; x1: number; y1: number; x2: number; y2: number; filled: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number; filled: boolean }
  | { kind: "polyline"; points: { x: number; y: number }[]; filled: boolean }
  | { kind: "arc"; start: { x: number; y: number }; mid: { x: number; y: number }; end: { x: number; y: number } };

export interface ParsedSymbol {
  name: string;
  shapes: SymbolShape[];
  pins: SymbolPin[];
  /** 未能识别而跳过的图元数量(诚实计数) */
  skipped: number;
}

function fillIsSolid(node: SList): boolean {
  const f = child(node, "fill");
  const type = f ? atom(child(f, "type"), 1) : null;
  return type === "outline" || type === "color";
}

function parseShape(node: SList): SymbolShape | null {
  switch (node.head) {
    case "rectangle": {
      const s = xy(child(node, "start"));
      const e = xy(child(node, "end"));
      if (!s || !e) return null;
      return { kind: "rect", x1: s.x, y1: s.y, x2: e.x, y2: e.y, filled: fillIsSolid(node) };
    }
    case "circle": {
      const c = xy(child(node, "center"));
      const r = num(child(node, "radius"), 1);
      if (!c || r === null) return null;
      return { kind: "circle", cx: c.x, cy: c.y, r, filled: fillIsSolid(node) };
    }
    case "polyline": {
      const pts = child(node, "pts");
      if (!pts) return null;
      const points = children(pts, "xy")
        .map((p) => xy(p))
        .filter((p): p is { x: number; y: number; angle: number } => p !== null);
      if (points.length < 2) return null;
      return { kind: "polyline", points, filled: fillIsSolid(node) };
    }
    case "arc": {
      const s = xy(child(node, "start"));
      const m = xy(child(node, "mid"));
      const e = xy(child(node, "end"));
      if (!s || !m || !e) return null;
      return { kind: "arc", start: s, mid: m, end: e };
    }
    default:
      return null;
  }
}

const SHAPE_HEADS = new Set(["rectangle", "circle", "polyline", "arc"]);

export function parseKicadSymbol(src: string): ParsedSymbol {
  const root = parseSexpr(src);
  const top = children(root, "symbol")[0];
  if (!top) throw new Error("未找到 symbol 定义");
  const name = atom(top, 1) ?? "(未命名符号)";

  const shapes: SymbolShape[] = [];
  const pins: SymbolPin[] = [];
  let skipped = 0;

  // 单元子符号(NAME_0_1 / NAME_1_1)承载图形与引脚
  const units: SList[] = [top, ...children(top, "symbol")];
  for (const unit of units) {
    for (const item of unit.items) {
      if (!isList(item) || item.head === null) continue;
      if (SHAPE_HEADS.has(item.head)) {
        const s = parseShape(item);
        if (s) shapes.push(s);
        else skipped++;
        continue;
      }
      if (item.head === "pin") {
        const at = xy(child(item, "at"));
        const length = num(child(item, "length"), 1);
        if (!at || length === null) {
          skipped++;
          continue;
        }
        pins.push({
          x: at.x,
          y: at.y,
          angle: at.angle,
          length,
          name: atom(child(item, "name"), 1) ?? "",
          number: atom(child(item, "number"), 1) ?? "",
          electricalType: atom(item, 1) ?? "unspecified",
        });
      }
    }
  }

  if (shapes.length === 0 && pins.length === 0) {
    throw new Error("符号中没有可渲染的图形或引脚");
  }
  return { name, shapes, pins, skipped };
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function symbolBounds(sym: ParsedSymbol): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const s of sym.shapes) {
    if (s.kind === "rect") {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    } else if (s.kind === "circle") {
      add(s.cx - s.r, s.cy - s.r);
      add(s.cx + s.r, s.cy + s.r);
    } else if (s.kind === "polyline") {
      for (const p of s.points) add(p.x, p.y);
    } else {
      add(s.start.x, s.start.y);
      add(s.mid.x, s.mid.y);
      add(s.end.x, s.end.y);
    }
  }
  for (const p of sym.pins) {
    add(p.x, p.y);
    const rad = (p.angle * Math.PI) / 180;
    add(p.x + p.length * Math.cos(rad), p.y + p.length * Math.sin(rad));
  }
  return b;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

/**
 * 渲染为 SVG 字符串。
 * 颜色全部走 CSS 变量,跟随系统主题(白标底座要求)。
 */
export function renderSymbolSvg(sym: ParsedSymbol): string {
  const b = symbolBounds(sym);
  // Y 翻转:SVG y = -KiCad y
  const pad = 6;
  const minX = b.minX - pad;
  const maxX = b.maxX + pad;
  const minY = -b.maxY - pad;
  const maxY = -b.minY + pad;
  const w = maxX - minX;
  const h = maxY - minY;

  const parts: string[] = [];
  const stroke = `stroke="var(--brand)" stroke-width="0.254" fill="none" stroke-linecap="round"`;
  const fillBody = `fill="color-mix(in srgb, var(--brand) 8%, transparent)"`;

  for (const s of sym.shapes) {
    if (s.kind === "rect") {
      const x = Math.min(s.x1, s.x2);
      const y = -Math.max(s.y1, s.y2);
      parts.push(
        `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(Math.abs(s.x2 - s.x1))}" height="${fmt(
          Math.abs(s.y2 - s.y1),
        )}" ${stroke} ${fillBody} />`,
      );
    } else if (s.kind === "circle") {
      parts.push(
        `<circle cx="${fmt(s.cx)}" cy="${fmt(-s.cy)}" r="${fmt(s.r)}" ${stroke} ${s.filled ? fillBody : ""} />`,
      );
    } else if (s.kind === "polyline") {
      const d = s.points.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(" ");
      parts.push(`<polyline points="${d}" ${stroke} ${s.filled ? fillBody : ""} />`);
    } else {
      // 三点圆弧:用二次贝塞尔近似控制点(经过 mid 的等价控制点)
      const cx = 2 * s.mid.x - (s.start.x + s.end.x) / 2;
      const cy = 2 * s.mid.y - (s.start.y + s.end.y) / 2;
      parts.push(
        `<path d="M ${fmt(s.start.x)} ${fmt(-s.start.y)} Q ${fmt(cx)} ${fmt(-cy)} ${fmt(s.end.x)} ${fmt(
          -s.end.y,
        )}" ${stroke} />`,
      );
    }
  }

  for (const p of sym.pins) {
    const rad = (p.angle * Math.PI) / 180;
    const ex = p.x + p.length * Math.cos(rad);
    const ey = p.y + p.length * Math.sin(rad);
    parts.push(
      `<line x1="${fmt(p.x)}" y1="${fmt(-p.y)}" x2="${fmt(ex)}" y2="${fmt(-ey)}" ${stroke} />`,
    );
    parts.push(
      `<circle cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="0.35" fill="var(--brand)" stroke="none" />`,
    );
    // 引脚方向在 SVG 坐标下的"指向符号体内部"的分量(SVG y 与 KiCad y 相反)
    const inX = Math.cos(rad);
    const inY = -Math.sin(rad);
    const vertical = Math.abs(inY) > Math.abs(inX);

    // 引脚号:压在引脚线上方(竖直引脚则在左侧)
    if (p.number) {
      const mx = (p.x + ex) / 2;
      const my = -(p.y + ey) / 2;
      parts.push(
        vertical
          ? `<text x="${fmt(mx - 0.35)}" y="${fmt(my)}" font-size="1" text-anchor="middle" fill="var(--gray-500)" transform="rotate(-90 ${fmt(
              mx - 0.35,
            )} ${fmt(my)})">${esc(p.number)}</text>`
          : `<text x="${fmt(mx)}" y="${fmt(my - 0.45)}" font-size="1" text-anchor="middle" fill="var(--gray-500)">${esc(
              p.number,
            )}</text>`,
      );
    }

    // 引脚名:写进符号体内侧,文字方向背离引脚线
    if (p.name && p.name !== "~") {
      const nx = ex + inX * 0.8;
      const ny = -ey + inY * 0.8;
      // 竖直引脚的文字整体旋转 -90°(+x 变成向上),故两种情况的锚点判断相反
      const anchor = vertical ? (inY > 0 ? "end" : "start") : inX > 0 ? "start" : "end";
      parts.push(
        vertical
          ? `<text x="${fmt(nx)}" y="${fmt(ny + 0.4)}" font-size="1.15" text-anchor="${anchor}" fill="var(--gray-700)" transform="rotate(-90 ${fmt(
              nx,
            )} ${fmt(ny + 0.4)})">${esc(p.name)}</text>`
          : `<text x="${fmt(nx)}" y="${fmt(ny + 0.4)}" font-size="1.15" text-anchor="${anchor}" fill="var(--gray-700)">${esc(
              p.name,
            )}</text>`,
      );
    }
  }

  // 图元包进 data-zoom-layer:缩放由 SVG 自己的 <g transform> 承担,
  // 而不是对整块 DOM 做 CSS transform —— 后者会把图层先栅格化再放大,字和线都会糊。
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(w)} ${fmt(h)}"`,
    ` role="img" aria-label="${esc(sym.name)} 原理图符号" style="width:100%;height:auto;max-height:520px">`,
    `<g data-zoom-layer="1">`,
    parts.join(""),
    `</g></svg>`,
  ].join("");
}
