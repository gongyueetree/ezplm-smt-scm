import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  checkContentLength,
  guessGerberKind,
} from "@/lib/domain/attachment-limits";
import { GerberManifestSchema, GOLDEN_ROOT } from "./manifest";

/**
 * F5:Gerber golden —— 锁定**分类与限额判定**的口径。
 * 上传链路的 HTTP 行为(流式、413、字节数校验拒残档)由
 * tests/e2e/e1b 与 zz-e9 在每次 CI 覆盖,此处不重复。
 */
const manifest = GerberManifestSchema.parse(
  JSON.parse(readFileSync(path.join(GOLDEN_ROOT, "gerber/manifest.json"), "utf-8")),
);

describe("Gerber golden", () => {
  for (const c of manifest.classification) {
    it(`分类:${c.name} → ${c.expectKind}`, () => {
      expect(guessGerberKind(c.name)).toBe(c.expectKind);
    });
  }

  for (const s of manifest.sizeChecks) {
    it(`限额:${s.label}`, () => {
      const r = checkContentLength(s.contentLength, s.maxMb * 1024 * 1024, s.maxMb);
      expect(r.ok).toBe(s.expectOk);
      if (!r.ok && s.expectCode) expect(r.code).toBe(s.expectCode);
    });
  }

  it("zip 夹具存在且形态符合说明(合法小包 / 非法包各一)", () => {
    const small = readFileSync(path.join(GOLDEN_ROOT, "gerber/small.zip"));
    const malformed = readFileSync(path.join(GOLDEN_ROOT, "gerber/malformed.zip"));
    // zip 魔数在,但内容合法性截然不同 —— 上传链路两者都**只存不解析**,
    // 这里锁的是夹具本身不被人误改
    expect(small.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(malformed.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(small.byteLength).toBeGreaterThan(100);
    expect(malformed.byteLength).toBeLessThan(100);
  });
});
