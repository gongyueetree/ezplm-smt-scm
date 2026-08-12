import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_MB_CEILING,
  DEFAULT_ATTACHMENT_MAX_MB,
  checkContentLength,
  guessGerberKind,
  resolveMaxBytes,
  shouldParseAtUpload,
} from "@/lib/domain/attachment-limits";

/**
 * E1b(客户 Q13:「gerber 无固定大小,无法作为附件传入,出现死机情况」)。
 *
 * 核心断言:**大小判定必须发生在读 body 之前**。
 * 旧实现先 `await req.formData()` 把整包缓冲进内存,再检查 20MB 上限 ——
 * 传 200MB 就是先吃下 200MB 再说"超限",容器内存扛不住就是"死机"。
 */

const MB = 1024 * 1024;

describe("上限可配置", () => {
  it("未配置时用默认 100MB —— 20MB 对 Gerber 包不够,客户原话「无固定大小」", () => {
    const r = resolveMaxBytes(undefined);
    expect(r.maxMb).toBe(DEFAULT_ATTACHMENT_MAX_MB);
    expect(r.usedDefault).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("正常配置生效", () => {
    const r = resolveMaxBytes("250");
    expect(r.maxMb).toBe(250);
    expect(r.maxBytes).toBe(250 * MB);
    expect(r.usedDefault).toBe(false);
  });

  it("**非法值回落默认并给出原因**,不静默按 0 处理", () => {
    for (const bad of ["abc", "-5", "0"]) {
      const r = resolveMaxBytes(bad);
      expect(r.usedDefault).toBe(true);
      expect(r.reason).toContain(bad);
    }
  });

  it("超过天花板同样回落 —— 再大就该走线下交换", () => {
    const r = resolveMaxBytes(String(ATTACHMENT_MAX_MB_CEILING + 1));
    expect(r.usedDefault).toBe(true);
    expect(r.reason).toContain("超过上限");
  });
});

describe("读 body 之前的大小校验", () => {
  const { maxBytes, maxMb } = resolveMaxBytes("100");

  it("正常大小放行,并回报字节数", () => {
    const r = checkContentLength(String(50 * MB), maxBytes, maxMb);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.bytes).toBe(50 * MB);
  });

  it("**超限在读取前就拒**,并说清多大、上限多少、可调", () => {
    const r = checkContentLength(String(200 * MB), maxBytes, maxMb);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("too_large");
    expect(r.ok === false && r.message).toContain("200.0MB");
    expect(r.ok === false && r.message).toContain("100MB");
    expect(r.ok === false && r.message).toContain("ATTACHMENT_MAX_MB");
  });

  it("**没有 Content-Length 一律拒绝** —— 长度未知就放行等于把稳定性交给运气", () => {
    for (const h of [null, "", "abc", "-1"]) {
      const r = checkContentLength(h, maxBytes, maxMb);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.code).toBe("unknown_length");
    }
  });

  it("恰好等于上限放行,超出 1 字节即拒(边界不能反过来)", () => {
    expect(checkContentLength(String(maxBytes), maxBytes, maxMb).ok).toBe(true);
    expect(checkContentLength(String(maxBytes + 1), maxBytes, maxMb).ok).toBe(false);
  });
});

describe("Gerber 扩展名识别", () => {
  it("客户点名的扩展名都认得", () => {
    for (const f of ["top.GTL", "bot.gbl", "mask.GTS", "silk.gto", "outline.GKO", "drill.drl", "a.gbr"]) {
      expect(guessGerberKind(f), f).toBe("GERBER");
    }
  });

  it("压缩包单独归类 —— 它可能装着 Gerber,但不是 Gerber 本身", () => {
    expect(guessGerberKind("pcb.zip")).toBe("ARCHIVE");
    expect(guessGerberKind("pcb.7z")).toBe("ARCHIVE");
  });

  it("其它文件不误判", () => {
    expect(guessGerberKind("bom.xlsx")).toBe("OTHER");
    expect(guessGerberKind("noext")).toBe("OTHER");
  });

  it("**认出扩展名不等于会解析** —— 上传阶段一律不解析", () => {
    expect(shouldParseAtUpload()).toBe(false);
  });
});
