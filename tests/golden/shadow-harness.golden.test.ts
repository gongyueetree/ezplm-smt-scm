/**
 * REF-0.8:对拍框架在**真实语料上的自检**。
 *
 * 这不是又一套业务断言,而是给 REF-1..REF-4 备好的模板与保险:
 * 证明「枚举语料 → 跑生产管线 → 逐字段对拍 → 汇总」这条链在真实夹具上是通的,
 * 并且在新旧实现相同时**必须**给出 readyToFlip=true、任何差异都跑不掉。
 *
 * 将来 REF-2 的用法就是把下面的 `next` 从"同一个生产管线"
 * 换成 V2 实现,其余一行不用改。
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractRows } from "@/lib/server/file-parse";
import {
  detectColumnMapping,
  reconcileImport,
  toStandardLinesTraced,
} from "@/lib/domain/bom-parse";
import {
  shadowRun,
  summarizeShadowRuns,
  type ShadowOutcome,
} from "@/lib/domain/shadow-compare";
import { corpusLabel, loadBomCorpus } from "../shadow/corpus";

/** 与 /api/bom/import 同一条生产管线(与 bom.golden.test.ts 保持一致) */
async function parsePipeline(file: string) {
  const extracted = await extractRows(path.basename(file), readFileSync(file), undefined);
  const mapping = detectColumnMapping(extracted.rows);
  const { lines, trace } = toStandardLinesTraced(extracted.rows, mapping);
  return { mapping, lines, recon: reconcileImport(trace, lines) };
}

describe("REF-0.8 对拍框架:真实 BOM 语料自检", () => {
  const corpus = loadBomCorpus();

  it("语料非空且确定 —— 对拍报告要可复现,输入顺序不能随文件系统变", () => {
    expect(corpus.length).toBeGreaterThan(0);
    const again = loadBomCorpus();
    expect(again.map(corpusLabel)).toEqual(corpus.map(corpusLabel));
    // 只收可解析的输入,manifest.json / README.md 不算语料
    expect(corpus.every((c) => [".csv", ".xlsx", ".xls"].includes(c.ext))).toBe(true);
  });

  it("新旧同实现 → 全 MATCH 且 readyToFlip", async () => {
    const outcomes: ShadowOutcome<unknown>[] = [];
    for (const item of corpus) {
      outcomes.push(
        await shadowRun({
          label: corpusLabel(item),
          old: () => parsePipeline(item.file),
          next: () => parsePipeline(item.file),
        }),
      );
    }
    const s = summarizeShadowRuns(outcomes);
    expect(s.total).toBe(corpus.length);
    expect(s.nextFailed).toBe(0);
    expect(s.diff, `不应有差异,topPaths=${JSON.stringify(s.topPaths)}`).toBe(0);
    expect(s.readyToFlip).toBe(true);
  });

  it("**注入一处差异必须被抓到**,且不会被误判成可切换", async () => {
    const item = corpus[0];
    const o = await shadowRun({
      label: corpusLabel(item),
      old: () => parsePipeline(item.file),
      next: async () => {
        const r = await parsePipeline(item.file);
        // 模拟"新实现少认了一行"——这正是重构最容易出的那类回归
        return { ...r, lines: r.lines.slice(1) };
      },
    });
    expect(o.status).toBe("DIFF");
    expect(o.report!.total).toBeGreaterThan(0);
    expect(summarizeShadowRuns([o]).readyToFlip).toBe(false);
  });

  it("新实现炸掉时,生产结果照常返回(对拍绝不影响线上)", async () => {
    const item = corpus[0];
    const expected = await parsePipeline(item.file);
    const o = await shadowRun({
      label: corpusLabel(item),
      old: () => parsePipeline(item.file),
      next: () => {
        throw new Error("V2 尚未实现");
      },
    });
    expect(o.status).toBe("NEXT_FAILED");
    expect(o.result).toEqual(expected);
    expect(summarizeShadowRuns([o]).readyToFlip).toBe(false);
  });

  it("差异报告默认脱敏:真实语料的值不得出现在报告里", async () => {
    const item = corpus[0];
    const o = await shadowRun({
      label: corpusLabel(item),
      old: () => parsePipeline(item.file),
      next: async () => ({ ...(await parsePipeline(item.file)), lines: [] }),
    });
    const dump = JSON.stringify(o.report);
    // 脱敏后只应出现类型/长度摘要,不应出现原始单元格文本
    expect(dump).not.toMatch(/STM32|MURATA|YAGEO/i);
    expect(dump).toMatch(/array\(\d+\)|string\(\d+\)|int|object\(\d+\)/);
  });
});
