import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractRows } from "@/lib/server/file-parse";
import {
  detectColumnMapping,
  reconcileImport,
  toStandardLinesTraced,
  type RowTrace,
} from "@/lib/domain/bom-parse";
import { BomManifestSchema, loadManifests } from "./manifest";
import { generateBomCsv } from "./seeded";

/**
 * F5:BOM golden 套件 —— **合并门禁**(任何一条不平衡即阻断)。
 *
 * runner 只做两件事:跑生产管线(extractRows → detectColumnMapping →
 * toStandardLinesTraced → reconcileImport,与 /api/bom/import 同一条路)、
 * 按 manifest 断言。期望值来自夹具的构造方式,不是快照。
 *
 * 失败信息必须指得出**哪一行、哪个阶段**:断言消息附完整行去向账本。
 */

function ledgerDump(trace: readonly RowTrace[]): string {
  return trace
    .map((t) => `  row${t.sourceRow} ${t.disposition} ${JSON.stringify(t.cells).slice(0, 60)}`)
    .join("\n");
}

async function runPipeline(filePath: string) {
  const buffer = readFileSync(filePath);
  const extracted = await extractRows(path.basename(filePath), buffer, undefined);
  expect(
    extracted.requiresManualTranscription,
    `${filePath} 应能自动解析(source=${extracted.source} note=${extracted.note})`,
  ).toBe(false);
  const mapping = detectColumnMapping(extracted.rows);
  const { lines, trace } = toStandardLinesTraced(extracted.rows, mapping);
  return { extracted, mapping, lines, trace, recon: reconcileImport(trace, lines) };
}

describe("BOM golden:每一行都有去向,账必须平", () => {
  for (const { dir, manifest } of loadManifests("bom", BomManifestSchema)) {
    const name = path.relative(path.resolve(__dirname, "../fixtures/golden"), dir);

    it(`${name}:${manifest.file}`, async () => {
      const { extracted, lines, trace, recon } = await runPipeline(path.join(dir, manifest.file));
      const e = manifest.expected;
      const dump = `\n—— 行去向账本 ——\n${ledgerDump(trace)}`;

      // 恒等式与账本自检(所有夹具无条件适用)
      expect(recon.balanced, `账不平${dump}`).toBe(true);
      expect(trace.length, `去向记录数 ≠ totalRows${dump}`).toBe(recon.totalRows);
      expect(new Set(trace.map((t) => t.sourceRow)).size, `行号重复${dump}`).toBe(trace.length);
      expect(
        recon.recognized + recon.mergedIntoPrevious + recon.nonBusiness + recon.needsReview,
        `分类之和 ≠ 总数${dump}`,
      ).toBe(recon.totalRows);

      // manifest 逐项(构造推导的期望)
      expect(recon.totalRows, `totalRows${dump}`).toBe(e.totalRows);
      expect(recon.recognized, `recognized${dump}`).toBe(e.recognized);
      expect(recon.mergedIntoPrevious, `mergedIntoPrevious${dump}`).toBe(e.mergedIntoPrevious);
      expect(recon.nonBusiness, `nonBusiness${dump}`).toBe(e.nonBusiness);
      expect(recon.needsReview, `needsReview${dump}`).toBe(e.needsReview);
      expect(recon.withIssues, `withIssues${dump}`).toBe(e.withIssues);

      for (const check of e.rowChecks ?? []) {
        const t = trace.find((x) => x.sourceRow === check.sourceRow);
        expect(t, `第 ${check.sourceRow} 行没有去向记录 —— 在 extractRows/解析阶段丢失${dump}`).toBeTruthy();
        expect(t!.disposition, `第 ${check.sourceRow} 行去向不符${dump}`).toBe(check.disposition);
      }

      if (e.extractNoteContains) {
        expect(extracted.note ?? "", "extractRows 备注缺失").toContain(e.extractNoteContains);
      }

      // 识别行的 lineNo 与账本一一对应(结果表可与账本互查)
      const recognizedTrace = trace.filter((t) => t.disposition === "RECOGNIZED");
      expect(recognizedTrace.map((t) => t.lineNo)).toEqual(lines.map((l) => l.lineNo));
    });
  }

  it("大文件·快速档:10,500 行混合脏数据,生成器记账与解析对账必须一致", async () => {
    const { csv, expected } = generateBomCsv(10_500, 20260907);
    const rows = (await extractRows("gen-large.csv", Buffer.from(csv, "utf-8"), "text/csv")).rows;
    const mapping = detectColumnMapping(rows);
    const { lines, trace } = toStandardLinesTraced(rows, mapping);
    const recon = reconcileImport(trace, lines);

    expect(recon.balanced).toBe(true);
    expect(recon.totalRows).toBe(expected.totalRows);
    expect(recon.recognized).toBe(expected.recognized);
    expect(recon.nonBusiness).toBe(expected.nonBusiness);
    expect(recon.needsReview).toBe(expected.needsReview);
    expect(recon.withIssues).toBe(expected.withIssues);
  });

  // >10MB 慢档:GOLDEN_SLOW=1 才跑(CI 时间预算;HTTP 全链路由 zz-e9 E2E 每次覆盖)
  it.runIf(process.env.GOLDEN_SLOW === "1")(
    "大文件·慢速档:>10MB(E9 的 15MB 级场景),一行不丢",
    async () => {
      const { csv, expected } = generateBomCsv(17_000, 20260907, { padBytes: 700 });
      const buffer = Buffer.from(csv, "utf-8");
      expect(buffer.byteLength).toBeGreaterThan(10 * 1024 * 1024);
      const rows = (await extractRows("gen-huge.csv", buffer, "text/csv")).rows;
      const mapping = detectColumnMapping(rows);
      const { lines, trace } = toStandardLinesTraced(rows, mapping);
      const recon = reconcileImport(trace, lines);
      expect(recon.balanced).toBe(true);
      expect(recon.totalRows).toBe(expected.totalRows);
      expect(recon.recognized).toBe(expected.recognized);
    },
  );
});
