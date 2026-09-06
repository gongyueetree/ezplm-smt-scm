import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseReconText } from "@/lib/domain/recon-parse";
import { GOLDEN_ROOT, ReconManifestSchema } from "./manifest";

/** F5:AR/AP golden —— 生产入口是文本粘贴(parseReconText),照此口径 */
const dir = path.join(GOLDEN_ROOT, "ar-ap");

describe("AR/AP 对账 golden", () => {
  for (const mf of ["manifest-ar.json", "manifest-ap.json"]) {
    const manifest = ReconManifestSchema.parse(
      JSON.parse(readFileSync(path.join(dir, mf), "utf-8")),
    );
    it(`${manifest.file}`, () => {
      const r = parseReconText(readFileSync(path.join(dir, manifest.file), "utf-8"));
      const dump = `\nerrors=${JSON.stringify(r.errors)}`;
      expect(r.lines.length, `有效行${dump}`).toBe(manifest.expected.lines);
      expect(r.errors.length, `报错行${dump}`).toBe(manifest.expected.errors);
      // 金额与数量单价都缺的行必须报错,不当 0
      for (const e of r.errors) expect(e.message).toContain("不按 0");
    });
  }
});
