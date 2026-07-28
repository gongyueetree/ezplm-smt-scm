import { describe, expect, it } from "vitest";
import { parseKicadFootprint, renderFootprintSvg } from "@/lib/domain/kicad-footprint";
import { parseKicadSymbol, renderSymbolSvg } from "@/lib/domain/kicad-symbol";
import { atom, child, children, descendants, parseSexpr } from "@/lib/domain/sexpr";

const SYM = `(kicad_symbol_lib
  (version 20241209)
  (symbol "DEMO"
    (symbol "DEMO_0_1"
      (rectangle (start -5.08 -5.08) (end 5.08 5.08)
        (stroke (width 0.254)) (fill (type background)))
      (polyline (pts (xy -2 0) (xy 2 0)) (stroke (width 0.2)) (fill (type none)))
      (circle (center 0 2) (radius 1) (stroke (width 0.2)) (fill (type none))))
    (symbol "DEMO_1_1"
      (pin input line (at -7.62 2.54 0) (length 2.54)
        (name "IN" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin output line (at 7.62 2.54 180) (length 2.54)
        (name "OUT" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27)))))
      (pin power_in line (at 0 7.62 270) (length 2.54)
        (name "VCC" (effects (font (size 1.27 1.27))))
        (number "3" (effects (font (size 1.27 1.27))))))))`;

const MOD = `(footprint "DEMO-2" (version 20211014) (generator pcbnew)
  (layer "F.Cu")
  (fp_line (start -1 -1) (end 1 -1) (layer "F.SilkS") (width 0.12))
  (fp_circle (center 0 0) (end 0.5 0) (layer "F.Fab") (width 0.1))
  (fp_text reference "REF**" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1))))
  (pad "1" smd roundrect (at -0.9 0) (size 1 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
  (pad "2" thru_hole circle (at 0.9 0) (size 1.2 1.2) (drill 0.6) (layers "*.Cu" "*.Mask")))`;

describe("sexpr:S-表达式解析", () => {
  it("解析嵌套列表与带引号字符串", () => {
    const root = parseSexpr('(footprint "A B" (layer "F.Cu") (pad "1" smd rect))');
    expect(root.head).toBe("footprint");
    expect(atom(root, 1)).toBe("A B");
    expect(atom(child(root, "layer"), 1)).toBe("F.Cu");
    expect(children(root, "pad")).toHaveLength(1);
  });

  it("转义字符按字面处理", () => {
    const root = parseSexpr('(a "x\\"y" "p\\\\q")');
    expect(atom(root, 1)).toBe('x"y');
    expect(atom(root, 2)).toBe("p\\q");
  });

  it("descendants 递归查找后代节点", () => {
    const root = parseSexpr("(a (b (c 1)) (d (c 2)))");
    expect(descendants(root, "c")).toHaveLength(2);
  });

  it("括号不闭合时抛错并带行号,绝不返回半截结果", () => {
    expect(() => parseSexpr("(a (b 1)")).toThrow(/未闭合/);
    expect(() => parseSexpr('(a "unterminated')).toThrow(/未闭合/);
    expect(() => parseSexpr("(a) (b)")).toThrow(/顶层列表之后仍有内容/);
  });
});

describe("kicad-symbol:原理图符号", () => {
  const sym = parseKicadSymbol(SYM);

  it("解析出图形与引脚,skipped 如实计数", () => {
    expect(sym.name).toBe("DEMO");
    expect(sym.shapes.map((s) => s.kind).sort()).toEqual(["circle", "polyline", "rect"]);
    expect(sym.pins).toHaveLength(3);
    expect(sym.skipped).toBe(0);
  });

  it("引脚保留电气类型/长度/角度(角度指向符号体)", () => {
    const inPin = sym.pins.find((p) => p.number === "1")!;
    expect(inPin.electricalType).toBe("input");
    expect(inPin.angle).toBe(0);
    // at.x + length*cos(0) = -7.62 + 2.54 = -5.08 = 符号体左边界
    expect(inPin.x + inPin.length).toBeCloseTo(-5.08, 6);
  });

  it("渲染 SVG:Y 轴翻转(KiCad 向上 → SVG 向下)", () => {
    const svg = renderSymbolSvg(sym);
    expect(svg.startsWith("<svg")).toBe(true);
    // 矩形 y 取 -max(y1,y2) = -5.08
    expect(svg).toContain('<rect x="-5.08" y="-5.08"');
    // VCC 引脚在 KiCad y=7.62(上方),SVG 里应为负 y
    expect(svg).toContain('y1="-7.62"');
    expect(svg).toContain("IN");
    expect(svg).toContain("VCC");
  });

  it("文本做 XSS 转义,不把符号名当 HTML 注入", () => {
    const evil = SYM.replace('"IN"', '"<script>x</script>"');
    const svg = renderSymbolSvg(parseKicadSymbol(evil));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("没有可渲染内容时抛错,而不是给一张空图", () => {
    expect(() => parseKicadSymbol('(kicad_symbol_lib (symbol "X"))')).toThrow(/没有可渲染/);
  });
});

describe("kicad-footprint:PCB 封装", () => {
  const fp = parseKicadFootprint(MOD);

  it("解析焊盘与图元,识别过孔", () => {
    expect(fp.name).toBe("DEMO-2");
    expect(fp.pads).toHaveLength(2);
    expect(fp.shapes.map((s) => s.kind).sort()).toEqual(["circle", "line"]);
    const smd = fp.pads.find((p) => p.number === "1")!;
    expect(smd.type).toBe("smd");
    expect(smd.shape).toBe("roundrect");
    expect(smd.drill).toBeNull();
    const th = fp.pads.find((p) => p.number === "2")!;
    expect(th.type).toBe("thru_hole");
    expect(th.drill).toBe(0.6);
  });

  it("渲染 SVG:Y 轴不翻转(pcbnew 与 SVG 同向)", () => {
    const svg = renderFootprintSvg(fp);
    expect(svg).toContain('<line x1="-1" y1="-1" x2="1" y2="-1"');
    // 过孔中心留白
    expect(svg).toContain('r="0.3"');
    expect(svg).toContain(">1</text>");
  });

  it("只画丝印/装配/外框层,铜层不重复画(避免误导)", () => {
    const withCu = MOD.replace('(layer "F.SilkS") (width 0.12)', '(layer "F.Cu") (width 0.12)');
    const svg = renderFootprintSvg(parseKicadFootprint(withCu));
    expect(svg).not.toContain("<line");
  });

  it("不是封装文件时明确报错", () => {
    expect(() => parseKicadFootprint(SYM)).toThrow(/不是 kicad_mod/);
  });
});
