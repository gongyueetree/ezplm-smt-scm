import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCanonicalString,
  buildSignedHeaders,
  canonicalQuery,
  normalizeEzplmOrigin,
  signRequest,
} from "@/lib/providers/ezplm/signing";

const KEY = "test-api-key";

describe("query 规范化(必须与服务端一致)", () => {
  it("按 key 排序后 URL 编码", () => {
    expect(canonicalQuery({ pageSize: "10", keyword: "STM32" })).toBe("keyword=STM32&pageSize=10");
  });

  it("空值被过滤(undefined / null / 空串)", () => {
    expect(canonicalQuery({ a: "1", b: undefined, c: null, d: "" })).toBe("a=1");
  });

  it("特殊字符被编码", () => {
    expect(canonicalQuery({ keyword: "a b&c" })).toBe("keyword=a%20b%26c");
  });

  it("同 key 不同值时按值排序", () => {
    // 对象无法有重复 key,这里验证排序比较器对 value 的处理不会抛错
    expect(canonicalQuery({ b: "2", a: "1" })).toBe("a=1&b=2");
  });

  it("空参数得到空串", () => {
    expect(canonicalQuery({})).toBe("");
  });
});

describe("签名串与签名值(对齐手册 demo)", () => {
  const input = {
    method: "GET",
    path: "/api/v1/api-key/parts",
    params: { keyword: "STM32", pageSize: "10" },
    timestamp: "1750000000",
    nonce: "fixed-nonce",
  };

  it("签名串按 方法/路径/query/时间戳/随机串 换行拼接", () => {
    expect(buildCanonicalString(input)).toBe(
      "GET\n/api/v1/api-key/parts\nkeyword=STM32&pageSize=10\n1750000000\nfixed-nonce",
    );
  });

  it("签名值为 HMAC-SHA256 的 base64url,与手册 demo 算法一致", () => {
    const expected = crypto
      .createHmac("sha256", KEY)
      .update("GET\n/api/v1/api-key/parts\nkeyword=STM32&pageSize=10\n1750000000\nfixed-nonce")
      .digest("base64url");
    expect(signRequest(KEY, input)).toBe(expected);
  });

  it("任一要素变化都会改变签名(防篡改)", () => {
    const base = signRequest(KEY, input);
    expect(signRequest(KEY, { ...input, nonce: "other" })).not.toBe(base);
    expect(signRequest(KEY, { ...input, timestamp: "1750000001" })).not.toBe(base);
    expect(signRequest(KEY, { ...input, path: "/api/v1/api-key/other" })).not.toBe(base);
    expect(signRequest(KEY, { ...input, params: { keyword: "STM8" } })).not.toBe(base);
    expect(signRequest("other-key", input)).not.toBe(base);
  });
});

describe("签名头", () => {
  it("四个头齐备,时间戳为 Unix 秒", () => {
    const h = buildSignedHeaders(KEY, { method: "GET", path: "/p", params: {} }, {
      nowMs: 1_750_000_000_000,
      nonce: "n1",
    });
    expect(h["X-API-Key"]).toBe(KEY);
    expect(h["X-Timestamp"]).toBe("1750000000");
    expect(h["X-Nonce"]).toBe("n1");
    expect(h["X-Signature"]).toBe(
      signRequest(KEY, { method: "GET", path: "/p", params: {}, timestamp: "1750000000", nonce: "n1" }),
    );
  });

  it("未指定 nonce 时每次生成新的(一次性,防重放)", () => {
    const a = buildSignedHeaders(KEY, { method: "GET", path: "/p", params: {} });
    const b = buildSignedHeaders(KEY, { method: "GET", path: "/p", params: {} });
    expect(a["X-Nonce"]).not.toBe(b["X-Nonce"]);
  });
});

describe("Base URL 规范化", () => {
  it("只取 origin,忽略配置里误带的路径尾巴", () => {
    const r = normalizeEzplmOrigin("https://www.ezplm.cn/api/v1/api-");
    expect(r.origin).toBe("https://www.ezplm.cn");
    expect(r.warnings.join()).toContain("已忽略");
  });

  it("公网主机的 http 被强制升级为 https(API Key 不可明文过网)", () => {
    const r = normalizeEzplmOrigin("http://www.ezplm.cn/api/v1/api-");
    expect(r.origin).toBe("https://www.ezplm.cn");
    expect(r.warnings.join()).toContain("强制升级");
  });

  it("本地/内网地址保留 http(私有化部署常见形态),只提示不改写", () => {
    for (const u of ["http://localhost:8080", "http://127.0.0.1:3001", "http://192.168.1.10", "http://10.0.0.5"]) {
      const r = normalizeEzplmOrigin(u);
      expect(r.origin.startsWith("http://"), `${u} 不应被升级`).toBe(true);
      expect(r.warnings.join()).toContain("内网");
    }
  });

  it("配置正确时无警告", () => {
    const r = normalizeEzplmOrigin("https://www.ezplm.cn");
    expect(r.origin).toBe("https://www.ezplm.cn");
    expect(r.warnings).toEqual([]);
  });
});
