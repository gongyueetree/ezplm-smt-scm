import { describe, expect, it } from "vitest";
import { parseOcrTable } from "@/lib/providers/ocr/claude";
import { OcrError, ocrProviderMode } from "@/lib/providers/ocr/provider";

const OK = JSON.stringify({
  rows: [
    ["位号", "制造商料号", "用量"],
    ["C1", "GRM188R71H104KA93D", "100"],
    ["U1", "STM32F103C8T6", "2"],
  ],
});

describe("parseOcrTable:模型转写结果的解析与护栏", () => {
  it("正常 JSON 直接解析", () => {
    const r = parseOcrTable(OK);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[1][1]).toBe("GRM188R71H104KA93D");
    expect(r.note).toBeNull();
  });

  it("容忍 ```json 代码块与前后说明文字", () => {
    expect(parseOcrTable("好的,结果如下:\n```json\n" + OK + "\n```\n希望有帮助").rows).toHaveLength(3);
    expect(parseOcrTable("前言 " + OK + " 后记").rows).toHaveLength(3);
  });

  it("单元格空白归一,整行为空的行被剔除", () => {
    const raw = JSON.stringify({
      rows: [
        ["位号", " 制造商  料号 ", "用量"],
        ["", "", ""],
        ["C1", "GRM188", "100"],
      ],
    });
    const r = parseOcrTable(raw);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0][1]).toBe("制造商 料号");
  });

  it("列数不齐时补空占位而**不截断** —— 截断会静默丢数据", () => {
    const raw = JSON.stringify({
      rows: [
        ["位号", "料号", "用量"],
        ["C1", "GRM188"],
      ],
    });
    const r = parseOcrTable(raw);
    expect(r.rows[1]).toEqual(["C1", "GRM188", ""]);
    expect(r.note).toContain("逐行核对");
  });

  it("不是 JSON 时报错,绝不猜内容", () => {
    expect(() => parseOcrTable("这张图我看不清")).toThrow(OcrError);
    expect(() => parseOcrTable("这张图我看不清")).toThrow(/不是 JSON/);
  });

  it("JSON 语法错误时报错而不是返回半张表", () => {
    expect(() => parseOcrTable('{"rows": [["a","b"],}')).toThrow(/解析失败/);
  });

  it("结构不符(rows 不是二维字符串数组)时报错", () => {
    expect(() => parseOcrTable('{"rows": "C1,GRM188"}')).toThrow(/结构不符合预期/);
    expect(() => parseOcrTable('{"table": []}')).toThrow(/结构不符合预期/);
  });

  it("不足两行(缺表头或缺数据)时报错,不放行只有表头的空表", () => {
    expect(() => parseOcrTable(JSON.stringify({ rows: [["位号", "料号"]] }))).toThrow(/不足两行/);
  });
});

describe("ocrProviderMode:无凭据时不假装可用", () => {
  const original = process.env.ANTHROPIC_API_KEY;

  it("未配置 ANTHROPIC_API_KEY 时为 unavailable", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(ocrProviderMode()).toBe("unavailable");
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  });

  it("配置后为 claude", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    expect(ocrProviderMode()).toBe("claude");
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });
});
