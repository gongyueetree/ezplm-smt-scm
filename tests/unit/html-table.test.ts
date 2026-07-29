import { describe, expect, it } from "vitest";
import { cellTextFromHtml, decodeEntities, looksLikeHtmlTable, parseHtmlTable } from "@/lib/domain/html-table";

const SIMPLE = `
<html><body>
<table>
  <tr><th>位号</th><th>数量</th><th>MPN</th></tr>
  <tr><td>C1</td><td>10</td><td>GRM188R71H104KA93D</td></tr>
  <tr><td>U1</td><td>2</td><td>STM32F103C8T6</td></tr>
</table>
</body></html>`;

describe("decodeEntities / cellTextFromHtml", () => {
  it("解常见实体,&nbsp; 变普通空格", () => {
    expect(decodeEntities("A&nbsp;B&amp;C&lt;D&gt;")).toBe("A B&C<D>");
    expect(decodeEntities("&#39;x&#39;")).toBe("'x'");
    expect(decodeEntities("&#x41;")).toBe("A");
  });

  it("未知实体原样保留,不吞字符", () => {
    expect(decodeEntities("&unknownthing;")).toBe("&unknownthing;");
  });

  it("<br> 当空格处理,不把两行粘成一个词", () => {
    expect(cellTextFromHtml("0603<br/>100nF")).toBe("0603 100nF");
  });

  it("去掉内层标签并归一空白", () => {
    expect(cellTextFromHtml("  <b> STM32 </b>  <span>F103</span> ")).toBe("STM32 F103");
  });
});

describe("parseHtmlTable:还原表格结构", () => {
  it("表头与数据行按序还原", () => {
    expect(parseHtmlTable(SIMPLE)).toEqual([
      ["位号", "数量", "MPN"],
      ["C1", "10", "GRM188R71H104KA93D"],
      ["U1", "2", "STM32F103C8T6"],
    ]);
  });

  it("colspan 按占位展开,后续列不左移", () => {
    const html = `<table>
      <tr><td colspan="2">合并标题</td><td>C</td></tr>
      <tr><td>a</td><td>b</td><td>c</td></tr>
    </table>`;
    expect(parseHtmlTable(html)).toEqual([
      ["合并标题", "", "C"],
      ["a", "b", "c"],
    ]);
  });

  it("rowspan 在下一行补占位,列不错位", () => {
    const html = `<table>
      <tr><td rowspan="2">跨两行</td><td>b1</td></tr>
      <tr><td>b2</td></tr>
    </table>`;
    expect(parseHtmlTable(html)).toEqual([
      ["跨两行", "b1"],
      ["", "b2"],
    ]);
  });

  it("多个表格时取行数最多的那个(页眉页脚常见也是表格)", () => {
    const html = `
      <table><tr><td>页眉</td></tr></table>
      ${SIMPLE}
      <table><tr><td>页脚</td></tr></table>`;
    expect(parseHtmlTable(html)).toHaveLength(3);
  });

  it("补齐到统一列宽,避免后续按列取值越界", () => {
    const html = `<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>x</td></tr></table>`;
    expect(parseHtmlTable(html)).toEqual([
      ["a", "b", "c"],
      ["x", "", ""],
    ]);
  });

  it("整行为空的行被剔除", () => {
    const html = `<table><tr><td>a</td></tr><tr><td></td><td>  </td></tr></table>`;
    expect(parseHtmlTable(html)).toEqual([["a"]]);
  });

  it("没有表格时抛错,绝不返回空表冒充「这个文件没内容」", () => {
    expect(() => parseHtmlTable("<html><body>请登录</body></html>")).toThrow(/没有找到可解析的表格/);
  });

  it("th/td 混用与大小写标签都能解析", () => {
    const html = `<TABLE><TR><TH>A</TH><TD>b</TD></TR></TABLE>`;
    expect(parseHtmlTable(html)).toEqual([["A", "b"]]);
  });
});

describe("looksLikeHtmlTable", () => {
  it("有 table 或 html+tr 判为真", () => {
    expect(looksLikeHtmlTable(SIMPLE)).toBe(true);
    expect(looksLikeHtmlTable("<table><tr><td>x</td></tr></table>")).toBe(true);
  });

  it("纯 CSV 判为假", () => {
    expect(looksLikeHtmlTable("位号,数量\nC1,10")).toBe(false);
  });
});
