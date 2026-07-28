import { afterEach, describe, expect, it } from "vitest";
import { assertAllowedFileUrl, EzplmFileError } from "@/lib/server/ezplm-file";

const ORIGINAL = process.env.EZPLM_FILE_HOST_SUFFIXES;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EZPLM_FILE_HOST_SUFFIXES;
  else process.env.EZPLM_FILE_HOST_SUFFIXES = ORIGINAL;
});

describe("assertAllowedFileUrl:库文件拉取的 SSRF 关口", () => {
  it("放行 ezPLM 自有域(含七牛 CDN 子域)", () => {
    expect(assertAllowedFileUrl("https://qn.ezplm.com/symbol/x.kicad_sym?e=1&token=t").hostname).toBe(
      "qn.ezplm.com",
    );
    expect(assertAllowedFileUrl("https://files.ezplm.cn/a.step").hostname).toBe("files.ezplm.cn");
  });

  it("拒绝非白名单主机 —— 外部 API 返回的 URL 是不可信输入", () => {
    expect(() => assertAllowedFileUrl("https://evil.example.com/x.kicad_mod")).toThrow(EzplmFileError);
    expect(() => assertAllowedFileUrl("https://evil.example.com/x")).toThrow(/不在允许清单/);
  });

  it("拒绝把白名单当后缀拼在别的域名后面的伪装", () => {
    // 关键:不能用 includes/endsWith 裸判 —— "notezplm.com" 不得被 ".ezplm.com" 命中
    expect(() => assertAllowedFileUrl("https://notezplm.com/x")).toThrow(/不在允许清单/);
    expect(() => assertAllowedFileUrl("https://ezplm.com.evil.net/x")).toThrow(/不在允许清单/);
  });

  it("拒绝内网/回环地址(SSRF 常见目标)", () => {
    expect(() => assertAllowedFileUrl("https://127.0.0.1/x")).toThrow(/不在允许清单/);
    expect(() => assertAllowedFileUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
      /不在允许清单/,
    );
    expect(() => assertAllowedFileUrl("https://localhost:5433/x")).toThrow(/不在允许清单/);
  });

  it("拒绝非 https 协议(含 file: / http:)", () => {
    expect(() => assertAllowedFileUrl("http://qn.ezplm.com/x")).toThrow(/只允许 https/);
    expect(() => assertAllowedFileUrl("file:///etc/passwd")).toThrow(/只允许 https/);
  });

  it("非法 URL 直接拒绝", () => {
    expect(() => assertAllowedFileUrl("not a url")).toThrow(/不是合法 URL/);
  });

  it("白名单可由环境变量覆盖(私有化部署换域名)", () => {
    process.env.EZPLM_FILE_HOST_SUFFIXES = "cdn.customer.internal";
    expect(assertAllowedFileUrl("https://cdn.customer.internal/x").hostname).toBe(
      "cdn.customer.internal",
    );
    expect(() => assertAllowedFileUrl("https://qn.ezplm.com/x")).toThrow(/不在允许清单/);
  });
});
