import { describe, expect, it } from "vitest";
import { sniffFormat, UNSUPPORTED_HINT } from "@/lib/server/file-sniff";

function zipWith(entryName: string): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(entryName, "latin1")]);
}

describe("sniffFormat:按内容判定真实格式(扩展名只作兜底)", () => {
  it("识别 OOXML 工作簿", () => {
    expect(sniffFormat(zipWith("xl/workbook.xml"), "a.xlsx")).toBe("xlsx");
    expect(sniffFormat(zipWith("xl/worksheets/sheet1.xml"), "随便.bin")).toBe("xlsx");
  });

  it("识别 Apple Numbers(同为 zip,但内部不是工作簿)", () => {
    expect(sniffFormat(zipWith("Index/Document.iwa"), "a.numbers")).toBe("numbers");
    // 内部条目认不出来时,靠扩展名兜底
    expect(sniffFormat(zipWith("something-else"), "a.numbers")).toBe("numbers");
  });

  it("识别 Excel 97-2003 复合文档(不是 zip)", () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    // 关键:即使名字叫 .xlsx 也要认出来是旧格式
    expect(sniffFormat(ole, "看起来很新.xlsx")).toBe("xls-legacy");
  });

  it("**名字叫 .xlsx 的 HTML** 被认成 HTML —— 现场最常见的坑", () => {
    const html = Buffer.from('<!DOCTYPE html>\n<html lang="en"><body><table><tr><td>C1</td></tr></table></body></html>');
    expect(sniffFormat(html, "BOM.xlsx")).toBe("html");
  });

  it("没有 <table> 的网页也归 HTML —— 表格可能在几十 KB 之后,或压根没有", () => {
    const page = Buffer.from('<!DOCTYPE html>\n<html><head><title>Sign in</title></head><body>请登录</body></html>');
    expect(sniffFormat(page, "BOM.xlsx")).toBe("html");
  });

  it("PDF 与图片按魔数识别,不看扩展名", () => {
    expect(sniffFormat(Buffer.from("%PDF-1.7\n..."), "bom.xlsx")).toBe("pdf");
    expect(sniffFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), "bom.xlsx")).toBe("image");
    expect(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "bom.csv")).toBe("image");
  });

  it("纯文本兜底为 csv", () => {
    expect(sniffFormat(Buffer.from("位号,数量,MPN\nC1,10,GRM188"), "bom.xlsx")).toBe("csv");
  });

  it("空文件返回 unknown 而不是误判", () => {
    expect(sniffFormat(Buffer.alloc(0), "a.xlsx")).toBe("unknown");
  });

  it("无法解析的格式都有**可操作**的说明,不能只说失败", () => {
    for (const key of ["numbers", "xls-legacy", "zip-unknown"] as const) {
      const hint = UNSUPPORTED_HINT[key]!;
      expect(hint).toBeTruthy();
      // 必须告诉用户下一步怎么做
      expect(hint).toMatch(/请|导出|另存/);
    }
  });
});
