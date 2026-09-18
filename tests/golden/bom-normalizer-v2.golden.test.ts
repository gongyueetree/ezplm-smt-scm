/**
 * REF-2c:BOM 标准化管线 V2 与 V1 的对拍(Golden Master)。
 *
 * V2 只改结构、不改规则,所以验收口径是**逐字段零差异**,不是"差不多":
 * 1. 公共金样语料 —— 走与 /api/bom/import 相同的读文件 + 列映射;
 * 2. 种子大表(10 500 行,与 bom.golden 同种子);
 * 3. **分支覆盖型模糊语料**:按种子随机拼出空行 / 翻页表头 / 页脚 / 位号折行 /
 *    描述折行 / 仅位号 / 日期落进数量 / DNP / 正文落进料号列 / Value 推断型号 …
 *    并断言每一种去向、两种自校准结果都真的出现过 —— 否则"零差异"可能只是没测到。
 *
 * 差异报告走 shadowRun 默认脱敏,不输出原始单元格。
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractRows } from "@/lib/server/file-parse";
import { parseCsv } from "@/lib/domain/csv";
import { detectColumnMapping, toStandardLinesTraced, type RowDisposition } from "@/lib/domain/bom-parse";
import { normalizeBom } from "@/modules/bom/domain/normalizer/pipeline";
import { shadowRun, summarizeShadowRuns, type ShadowOutcome } from "@/lib/domain/shadow-compare";
import { corpusLabel, loadBomCorpus } from "../shadow/corpus";
import { generateBomCsv, mulberry32 } from "./seeded";

function shadow(label: string, rows: string[][]) {
  const mapping = detectColumnMapping(rows);
  return shadowRun({
    label,
    old: () => toStandardLinesTraced(rows, mapping, "v1"),
    next: () => toStandardLinesTraced(rows, mapping, "v2"),
  });
}

function expectReady(outcomes: ShadowOutcome<unknown>[]) {
  const s = summarizeShadowRuns(outcomes);
  expect(s.nextFailed).toBe(0);
  expect(s.diff, `差异集中在 ${JSON.stringify(s.topPaths)}`).toBe(0);
  expect(s.readyToFlip).toBe(true);
  return s;
}

/* ---------------- 模糊语料生成 ---------------- */

const HEADERS: string[][] = [
  ["位号", "数量", "MPN", "制造商", "描述", "封装"],
  ["Reference", "Qty", "Value", "Footprint"], // KiCad:无 MPN 列 → 走 Value 推断
  ["Designator", "Quantity", "Manufacturer Part Number", "Manufacturer", "Description"],
  ["序号", "客户料号", "内部料号", "位号", "用量", "规格"],
];

type Gen = () => number;
const pick = <T,>(rnd: Gen, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

function refList(rnd: Gen, n: number): string {
  const prefix = pick(rnd, ["C", "R", "U", "L", "D"]);
  const start = 1 + Math.floor(rnd() * 90);
  const style = pick(rnd, ["list", "range", "fullwidth", "space"]);
  if (style === "range" && n > 2) return `${prefix}${start}-${prefix}${start + n - 1}`;
  const refs = Array.from({ length: n }, (_, i) => `${prefix}${start + i}`);
  if (style === "fullwidth") return refs.join("，");
  if (style === "space") return refs.join(" ");
  return refs.join(", ");
}

/** 按表头列名放值;表头里没有的字段就丢掉 —— 模拟不同模板 */
function place(header: string[], v: Partial<Record<"ref" | "qty" | "mpn" | "mfr" | "desc" | "fp" | "cpn" | "ipn", string>>): string[] {
  const at: Record<string, keyof typeof v> = {
    位号: "ref", Reference: "ref", Designator: "ref",
    数量: "qty", Qty: "qty", Quantity: "qty", 用量: "qty",
    MPN: "mpn", "Manufacturer Part Number": "mpn",
    制造商: "mfr", Manufacturer: "mfr",
    描述: "desc", Value: "desc", Description: "desc", 规格: "desc",
    封装: "fp", Footprint: "fp",
    客户料号: "cpn", 内部料号: "ipn",
  };
  return header.map((h) => (at[h] ? (v[at[h]] ?? "") : ""));
}

function fuzzGrid(seed: number): string[][] {
  const rnd = mulberry32(seed);
  const header = pick(rnd, HEADERS);
  const rows: string[][] = [];
  if (rnd() < 0.4) rows.push(["某某科技 BOM 清单"], ["客户:示例客户", "版本:A1"]); // 标题块:表头不在第一行
  rows.push(header);

  const n = 5 + Math.floor(rnd() * 40);
  for (let i = 0; i < n; i++) {
    const k = rnd();
    const qtyN = 1 + Math.floor(rnd() * 12);
    if (k < 0.05) rows.push(header.map(() => (rnd() < 0.5 ? "" : " ")));
    else if (k < 0.08) rows.push([...header]);
    else if (k < 0.11) rows.push(place(header, { desc: pick(rnd, ["Page 2 of 3", "第 2 页,共 3 页", "page 1/4"]) }));
    else if (k < 0.15) rows.push(place(header, { desc: pick(rnd, ["续:耐压 50V", "X7R 10%", "以上为主料"]) }));
    else if (k < 0.24) rows.push(place(header, { ref: refList(rnd, 1 + Math.floor(rnd() * 4)) })); // 位号折行 / 仅位号
    else if (k < 0.27) rows.push(place(header, { ref: pick(rnd, ["备注:以上为主料", "TP1", "见附页"]) }));
    else if (k < 0.30) rows.push(place(header, { mfr: pick(rnd, ["Murata", "YAGEO"]) })); // 只有厂商
    else {
      // 正常物料行,夹带各种边界值
      const refCount = rnd() < 0.5 ? qtyN : Math.max(1, qtyN - 1 - Math.floor(rnd() * 3)); // 一半故意少列位号
      rows.push(
        place(header, {
          ref: rnd() < 0.9 ? refList(rnd, refCount) : "",
          qty: pick(rnd, [String(qtyN), String(qtyN), String(qtyN), `${qtyN} pcs`, "0", "-1", "2026/8/1", "", "１０", "8-10"]),
          mpn: pick(rnd, [
            "GRM188R71H104KA93D", "RC0603FR-0710KL", "STM32F103C8T6", "",
            "These resources are subject to change without notice by the vendor", // 正文落进料号列
          ]),
          mfr: pick(rnd, ["Murata", "YAGEO", "ST", ""]),
          desc: pick(rnd, ["0.1uF", "10k", "CH340E", "LPC824M201JHI33", "电容 100nF", ""]),
          fp: pick(rnd, ["Capacitor_SMD:C_0603_1608Metric", "Resistor_SMD:R_0402_1005Metric", "SOT-23-5", "CP_Elec_6.3x5.4", ""]),
          cpn: rnd() < 0.3 ? `CP-${Math.floor(rnd() * 1000)}` : "",
          ipn: rnd() < 0.3 ? `1-01-${Math.floor(rnd() * 9000)}` : "",
        }),
      );
    }
  }
  return rows;
}

describe("REF-2c:V2 管线与 V1 逐字段对拍", () => {
  it("公共金样语料:全部 MATCH", async () => {
    const corpus = loadBomCorpus();
    expect(corpus.length).toBeGreaterThan(0);
    const outcomes: ShadowOutcome<unknown>[] = [];
    for (const item of corpus) {
      const extracted = await extractRows(path.basename(item.file), readFileSync(item.file), undefined);
      outcomes.push(await shadow(corpusLabel(item), extracted.rows));
    }
    expect(expectReady(outcomes).total).toBe(corpus.length);
  });

  it("种子大表 10 500 行:MATCH", async () => {
    const { csv } = generateBomCsv(10_500, 20260907);
    expectReady([await shadow("seeded:10500", parseCsv(csv, ","))]);
  });

  it("**分支覆盖型模糊语料** 1500 张:全部 MATCH,且每一种去向与两种自校准都真的出现过", async () => {
    const outcomes: ShadowOutcome<unknown>[] = [];
    const seen = new Set<RowDisposition>();
    const modes = new Set<string>();
    let inferred = 0;

    for (let seed = 1; seed <= 1500; seed++) {
      const rows = fuzzGrid(seed);
      const o = await shadow(`fuzz:${seed}`, rows);
      outcomes.push(o);
      for (const t of o.result.trace) seen.add(t.disposition);
      inferred += o.result.lines.filter((l) => l.mpnSource === "inferred-from-value").length;
      modes.add(normalizeBom(rows, detectColumnMapping(rows)).calibration.mode);
    }

    expectReady(outcomes);
    expect([...seen].sort()).toEqual(
      ["BLANK", "INSUFFICIENT", "MERGED_INTO_PREVIOUS", "NO_IDENTIFIER", "PAGE_FOOTER", "RECOGNIZED", "REPEATED_HEADER"],
    );
    expect([...modes].sort()).toEqual(["MERGED", "PLAIN"]);
    expect(inferred).toBeGreaterThan(0);
  });

  it("对拍能抓到差异(自检):V2 少并一行就不是 MATCH", async () => {
    const rows = fuzzGrid(7);
    const mapping = detectColumnMapping(rows);
    const o = await shadowRun({
      label: "self-check",
      old: () => toStandardLinesTraced(rows, mapping, "v1"),
      next: () => {
        const r = toStandardLinesTraced(rows, mapping, "v2");
        return { ...r, trace: r.trace.slice(1) };
      },
    });
    expect(o.status).toBe("DIFF");
  });
});
