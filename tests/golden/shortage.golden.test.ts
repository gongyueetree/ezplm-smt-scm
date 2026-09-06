import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractRows } from "@/lib/server/file-parse";
import { parseShortageSheet } from "@/lib/domain/shortage-sheet";
import { GOLDEN_ROOT, ShortageManifestSchema } from "./manifest";

/** F5:缺料单 golden —— 与 /api/shortage/sheets 同一条解析路 */
const dir = path.join(GOLDEN_ROOT, "shortage");
const manifest = ShortageManifestSchema.parse(
  JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8")),
);

describe("缺料单 golden", () => {
  it(`${manifest.file}`, async () => {
    const extracted = await extractRows(
      manifest.file,
      readFileSync(path.join(dir, manifest.file)),
      undefined,
    );
    const r = parseShortageSheet(extracted.rows);
    expect(r.lines.length).toBe(manifest.expected.lines);
    expect(r.errors.length).toBe(manifest.expected.errors);
    for (const er of manifest.expected.errorRows) {
      const hit = r.errors.find((x) => x.row === er.row);
      expect(hit, `第 ${er.row} 行应报错并指回原表`).toBeTruthy();
      expect(hit!.message).toContain(er.messageContains);
    }
    // 空值必须是 null 不回落 0(缺口以单据为准的姊妹纪律)
    const sparse = r.lines.find((l) => l.availableInventory === null);
    expect(sparse, "留空的数量应解析为 null 而不是 0").toBeTruthy();
  });
});
