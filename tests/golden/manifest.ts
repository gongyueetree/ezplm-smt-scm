/**
 * F5:golden 夹具的 manifest 契约(zod)。
 *
 * 每个夹具目录一份 manifest.json,声明**期望结果**;runner 只做两件事:
 * 跑生产管线、按 manifest 断言。期望值全部来自夹具的**构造方式**
 * (写夹具的人知道自己放了几行什么),不是跑一遍后抄下来的快照 ——
 * 抄快照会把现有缺陷一并"钦定"为正确。
 *
 * BOM 的对账口径沿用生产恒等式(E1a):
 *   totalRows = recognized + mergedIntoPrevious + nonBusiness + needsReview
 * KICKOFF 公式里的 needsMapping/errors 与此的映射:
 *   needsMapping ≈ mergedIntoPrevious(结构性归并)、errors ≈ withIssues
 *   (识别成功但带解析问题的行,如数量非法)。
 * **不为对齐词汇而改生产语义** —— 见 docs/ROUND2_AUDIT.md §0.2。
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import path from "path";
import { z } from "zod";

export const GOLDEN_ROOT = path.resolve(__dirname, "../fixtures/golden");

/** BOM 夹具 manifest */
export const BomManifestSchema = z.object({
  file: z.string(),
  description: z.string(),
  expected: z.object({
    /** 表头之后的物理行数(对账分母) */
    totalRows: z.number().int().nonnegative(),
    recognized: z.number().int().nonnegative(),
    mergedIntoPrevious: z.number().int().nonnegative(),
    /** 空行 / 重复表头 / 页脚 */
    nonBusiness: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
    /** 识别成功但带解析问题的行数(KICKOFF 的 "errors") */
    withIssues: z.number().int().nonnegative(),
    mustBalance: z.literal(true),
    /** 关键行的去向抽查(可选):行号指原文件 1 基行号 */
    rowChecks: z
      .array(z.object({ sourceRow: z.number().int().positive(), disposition: z.string() }))
      .optional(),
    /** extractRows 备注须包含的子串(如多 sheet 取表说明);可选 */
    extractNoteContains: z.string().optional(),
  }),
});
export type BomManifest = z.infer<typeof BomManifestSchema>;

/** 供应商报价夹具 */
export const SupplierQuoteManifestSchema = z.object({
  file: z.string(),
  description: z.string(),
  fallbackCurrency: z.string(),
  expected: z.object({
    lines: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    /** 每条被跳过的行必须带原因,且行号指得回原文件 */
    skippedRows: z.array(z.object({ sourceRow: z.number().int(), reasonContains: z.string() })),
    /** 抽查某行的解析值 */
    lineChecks: z
      .array(
        z.object({
          mpn: z.string(),
          unitPrice: z.string(),
          currency: z.string(),
        }),
      )
      .optional(),
  }),
});

/** 缺料单夹具 */
export const ShortageManifestSchema = z.object({
  file: z.string(),
  description: z.string(),
  expected: z.object({
    lines: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    errorRows: z.array(z.object({ row: z.number().int(), messageContains: z.string() })),
  }),
});

/** AR/AP 对账文本夹具(生产入口是文本粘贴,见 recon-parse) */
export const ReconManifestSchema = z.object({
  file: z.string(),
  description: z.string(),
  expected: z.object({
    lines: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
});

/** Gerber 夹具:分类与大小判定(上传行为的 HTTP 层由 e1b E2E 覆盖) */
export const GerberManifestSchema = z.object({
  description: z.string(),
  classification: z.array(
    z.object({ name: z.string(), expectKind: z.enum(["GERBER", "ARCHIVE", "OTHER"]) }),
  ),
  sizeChecks: z.array(
    z.object({
      label: z.string(),
      contentLength: z.string().nullable(),
      maxMb: z.number(),
      expectOk: z.boolean(),
      expectCode: z.string().optional(),
    }),
  ),
  zipFiles: z.array(z.object({ file: z.string(), note: z.string() })),
});

/**
 * ERP 场景夹具 —— **与 Lab 仓库同一格式**
 * (gongyueetree/ezplm-erp-lab `tests/fixtures/erp/<scenario>/manifest.json`:
 *  `{ scenario, expected: {...} }`)。F4 的状态机矩阵测试消费它,
 * 两仓各自跑对方的契约校验,口径漂移即红。
 */
export const ErpScenarioManifestSchema = z.object({
  scenario: z.string(),
  expected: z.object({
    connection: z.enum(["READY", "NOT_CONFIGURED", "FAILED"]).optional(),
    syncStatus: z.enum(["SYNCED", "FAILED", "RETRY_REQUIRED", "BLOCKED"]).optional(),
  }),
});

/** Excess 夹具:导入管线尚不存在(见 runner 说明),先锁格式 */
export const ExcessManifestSchema = z.object({
  file: z.string(),
  description: z.string(),
  status: z.literal("PIPELINE_PENDING"),
  columns: z.array(z.string()),
});

/** 列出某域下所有带 manifest.json 的夹具目录/文件 */
export function loadManifests<T>(
  domain: string,
  schema: z.ZodType<T>,
): { dir: string; manifest: T }[] {
  const root = path.join(GOLDEN_ROOT, domain);
  if (!existsSync(root)) return [];
  const out: { dir: string; manifest: T }[] = [];
  const walk = (d: string) => {
    const mf = path.join(d, "manifest.json");
    if (existsSync(mf)) {
      out.push({ dir: d, manifest: schema.parse(JSON.parse(readFileSync(mf, "utf-8"))) });
      return;
    }
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
    }
  };
  walk(root);
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}
