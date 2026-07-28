/**
 * .kicad_mod(PCB 封装库)→ 可在线显示的 SVG。
 *
 * 坐标系:pcbnew 的 Y 轴向下,与 SVG 一致 → **不翻转**。
 * (符号库 Y 轴向上,需要翻转 —— 两者不同,别互相套用。)
 *
 * 纪律同 kicad-symbol.ts:只画能确定解析的图元,其余计入 skipped 并如实告知。
 */
import { atom, child, children, isList, num, parseSexpr, xy, type SList } from "./sexpr";

export interface FootprintPad {
  number: string;
  /** smd / thru_hole / np_thru_hole / connect */
  type: string;
  /** rect / roundrect / oval / circle / custom / trapezoid */
  shape: string;
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
  /** roundrect 的圆角比例(0–0.5) */
  roundRatio: number;
  /** 过孔直径(thru_hole 才有) */
  drill: number | null;
}

export type FootprintShape =
  | { kind: "line"; layer: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; layer: string; width: number; cx: number; cy: number; r: number }
  | { kind: "rect"; layer: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: "arc";
      layer: string;
      width: number;
      start: { x: number; y: number };
      mid: { x: number; y: number };
      end: { x: number; y: number };
    }
  | { kind: "poly"; layer: string; width: number; points: { x: number; y: number }[] };

export interface ParsedFootprint {
  name: string;
  pads: FootprintPad[];
  shapes: FootprintShape[];
  skipped: number;
}

function layerOf(node: SList): string {
  return atom(child(node, "layer"), 1) ?? "";
}

function widthOf(node: SList): number {
  const w = num(child(node, "width"), 1);
  if (w !== null) return w;
  const s = child(node, "stroke");
  return s ? (num(child(s, "width"), 1) ?? 0.12) : 0.12;
}

function parseShape(node: SList): FootprintShape | null {
  const layer = layerOf(node);
  const width = widthOf(node);
  switch (node.head) {
    case "fp_line": {
      const s = xy(child(node, "start"));
      const e = xy(child(node, "end"));
      if (!s || !e) return null;
      return { kind: "line", layer, width, x1: s.x, y1: s.y, x2: e.x, y2: e.y };
    }
    case "fp_rect": {
      const s = xy(child(node, "start"));
      const e = xy(child(node, "end"));
      if (!s || !e) return null;
      return { kind: "rect", layer, width, x1: s.x, y1: s.y, x2: e.x, y2: e.y };
    }
    case "fp_circle": {
      const c = xy(child(node, "center"));
      const e = xy(child(node, "end"));
      if (!c || !e) return null;
      return { kind: "circle", layer, width, cx: c.x, cy: c.y, r: Math.hypot(e.x - c.x, e.y - c.y) };
    }
    case "fp_arc": {
      const s = xy(child(node, "start"));
      const m = xy(child(node, "mid"));
      const e = xy(child(node, "end"));
      if (!s || !m || !e) return null;
      return { kind: "arc", layer, width, start: s, mid: m, end: e };
    }
    case "fp_poly": {
      const pts = child(node, "pts");
      if (!pts) return null;
      const points = children(pts, "xy")
        .map((p) => xy(p))
        .filter((p): p is { x: number; y: number; angle: number } => p !== null);
      if (points.length < 3) return null;
      return { kind: "poly", layer, width, points };
    }
    default:
      return null;
  }
}

const SHAPE_HEADS = new Set(["fp_line", "fp_rect", "fp_circle", "fp_arc", "fp_poly"]);

export function parseKicadFootprint(src: string): ParsedFootprint {
  const root = parseSexpr(src);
  if (root.head !== "footprint" && root.head !== "module") {
    throw new Error("不是 kicad_mod 封装文件");
  }
  const name = atom(root, 1) ?? "(未命名封装)";

  const pads: FootprintPad[] = [];
  const shapes: FootprintShape[] = [];
  let skipped = 0;

  for (const item of root.items) {
    if (!isList(item) || item.head === null) continue;
    if (SHAPE_HEADS.has(item.head)) {
      const s = parseShape(item);
      if (s) shapes.push(s);
      else skipped++;
      continue;
    }
    if (item.head === "pad") {
      const at = xy(child(item, "at"));
      const size = xy(child(item, "size"));
      if (!at || !size) {
        skipped++;
        continue;
      }
      const drillNode = child(item, "drill");
      pads.push({
        number: atom(item, 1) ?? "",
        type: atom(item, 2) ?? "smd",
        shape: atom(item, 3) ?? "rect",
        x: at.x,
        y: at.y,
        angle: at.angle,
        w: size.x,
        h: size.y,
        roundRatio: num(child(item, "roundrect_rratio"), 1) ?? 0.25,
        drill: drillNode ? num(drillNode, 1) : null,
      });
    }
  }

  if (pads.length === 0 && shapes.length === 0) {
    throw new Error("封装中没有可渲染的焊盘或图元");
  }
  return { name, pads, shapes, skipped };
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 只渲染这些层:丝印 / 装配 / 外框。铜层由焊盘表达,不重复画。 */
const LAYER_STYLE: Record<string, string> = {
  "F.SilkS": "var(--gray-600)",
  "B.SilkS": "var(--gray-400)",
  "F.Fab": "var(--gray-400)",
  "F.CrtYd": "var(--gray-300)",
  Edge_Cuts: "var(--gray-700)",
};

export function renderFootprintSvg(fp: ParsedFootprint): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of fp.pads) {
    const r = Math.max(p.w, p.h) / 2;
    add(p.x - r, p.y - r);
    add(p.x + r, p.y + r);
  }
  for (const s of fp.shapes) {
    if (s.kind === "line" || s.kind === "rect") {
      add(s.x1, s.y1);
      add(s.x2, s.y2);
    } else if (s.kind === "circle") {
      add(s.cx - s.r, s.cy - s.r);
      add(s.cx + s.r, s.cy + s.r);
    } else if (s.kind === "arc") {
      add(s.start.x, s.start.y);
      add(s.mid.x, s.mid.y);
      add(s.end.x, s.end.y);
    } else {
      for (const p of s.points) add(p.x, p.y);
    }
  }

  const pad = 0.8;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const parts: string[] = [];

  for (const s of fp.shapes) {
    const color = LAYER_STYLE[s.layer];
    if (!color) continue; // 铜层/阻焊等不画,避免误导
    const stroke = `stroke="${color}" stroke-width="${fmt(Math.max(s.width, 0.05))}" fill="none" stroke-linecap="round"`;
    if (s.kind === "line") {
      parts.push(`<line x1="${fmt(s.x1)}" y1="${fmt(s.y1)}" x2="${fmt(s.x2)}" y2="${fmt(s.y2)}" ${stroke} />`);
    } else if (s.kind === "rect") {
      parts.push(
        `<rect x="${fmt(Math.min(s.x1, s.x2))}" y="${fmt(Math.min(s.y1, s.y2))}" width="${fmt(
          Math.abs(s.x2 - s.x1),
        )}" height="${fmt(Math.abs(s.y2 - s.y1))}" ${stroke} />`,
      );
    } else if (s.kind === "circle") {
      parts.push(`<circle cx="${fmt(s.cx)}" cy="${fmt(s.cy)}" r="${fmt(s.r)}" ${stroke} />`);
    } else if (s.kind === "arc") {
      const cx = 2 * s.mid.x - (s.start.x + s.end.x) / 2;
      const cy = 2 * s.mid.y - (s.start.y + s.end.y) / 2;
      parts.push(
        `<path d="M ${fmt(s.start.x)} ${fmt(s.start.y)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(s.end.x)} ${fmt(s.end.y)}" ${stroke} />`,
      );
    } else {
      parts.push(`<polygon points="${s.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ")}" ${stroke} />`);
    }
  }

  for (const p of fp.pads) {
    const fill = p.type === "smd" ? "var(--brand)" : "var(--ai)";
    const transform = p.angle ? ` transform="rotate(${fmt(p.angle)} ${fmt(p.x)} ${fmt(p.y)})"` : "";
    if (p.shape === "circle" || (p.shape === "oval" && Math.abs(p.w - p.h) < 1e-6)) {
      parts.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(p.w / 2)}" fill="${fill}" opacity="0.85"${transform} />`);
    } else if (p.shape === "oval") {
      parts.push(
        `<rect x="${fmt(p.x - p.w / 2)}" y="${fmt(p.y - p.h / 2)}" width="${fmt(p.w)}" height="${fmt(
          p.h,
        )}" rx="${fmt(Math.min(p.w, p.h) / 2)}" fill="${fill}" opacity="0.85"${transform} />`,
      );
    } else {
      const r = p.shape === "roundrect" ? Math.min(p.w, p.h) * p.roundRatio : 0;
      parts.push(
        `<rect x="${fmt(p.x - p.w / 2)}" y="${fmt(p.y - p.h / 2)}" width="${fmt(p.w)}" height="${fmt(
          p.h,
        )}" rx="${fmt(r)}" fill="${fill}" opacity="0.85"${transform} />`,
      );
    }
    if (p.drill !== null) {
      parts.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(p.drill / 2)}" fill="var(--card-bg, #fff)" />`);
    }
    if (p.number) {
      parts.push(
        `<text x="${fmt(p.x)}" y="${fmt(p.y + 0.16)}" font-size="${fmt(
          Math.min(0.5, Math.min(p.w, p.h) * 0.7),
        )}" text-anchor="middle" fill="var(--gray-0, #fff)">${esc(p.number)}</text>`,
      );
    }
  }

  // data-zoom-layer 的作用见 kicad-symbol.ts:缩放走 SVG 变换,保证矢量清晰
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(maxX - minX)} ${fmt(
      maxY - minY,
    )}" role="img" aria-label="${esc(fp.name)} PCB 封装" style="width:100%;height:auto;max-height:420px">`,
    `<g data-zoom-layer="1">`,
    parts.join(""),
    `</g></svg>`,
  ].join("");
}
