import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractRows } from "@/lib/server/file-parse";
import {
  detectSupplierQuoteMapping,
  toSupplierQuoteLines,
} from "@/lib/domain/supplier-quote-parse";
import { GOLDEN_ROOT, SupplierQuoteManifestSchema } from "./manifest";

/** F5:线下报价 golden —— 与 /api/procurement/rfq/[id]/quotes 同一条解析路 */
const dir = path.join(GOLDEN_ROOT, "supplier-quotes");
const manifest = SupplierQuoteManifestSchema.parse(
  JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8")),
);

describe("供应商报价 golden", () => {
  it(`${manifest.file}:有效行与逐行报因`, async () => {
    const extracted = await extractRows(
      manifest.file,
      readFileSync(path.join(dir, manifest.file)),
      undefined,
    );
    const mapping = detectSupplierQuoteMapping(extracted.rows);
    const result = toSupplierQuoteLines(extracted.rows, mapping, {
      fallbackCurrency: manifest.fallbackCurrency,
    });

    const dump = `\nskipped=${JSON.stringify(result.skipped)}`;
    expect(result.lines.length, `有效行数${dump}`).toBe(manifest.expected.lines);
    expect(result.skipped.length, `跳过行数${dump}`).toBe(manifest.expected.skipped);

    // 每条被跳过的行:行号指得回原文件、原因写明白
    for (const sk of manifest.expected.skippedRows) {
      const hit = result.skipped.find((x) => x.sourceRow === sk.sourceRow);
      expect(hit, `第 ${sk.sourceRow} 行应被逐行报因,而不是静默消失${dump}`).toBeTruthy();
      expect(hit!.reason).toContain(sk.reasonContains);
    }

    for (const lc of manifest.expected.lineChecks ?? []) {
      const line = result.lines.find((l) => l.mpn === lc.mpn);
      expect(line, `${lc.mpn} 应在有效行里`).toBeTruthy();
      expect(line!.unitPrice).toBe(lc.unitPrice);
      expect(line!.currency).toBe(lc.currency);
    }
  });
});
