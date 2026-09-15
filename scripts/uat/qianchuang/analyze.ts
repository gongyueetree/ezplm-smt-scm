/**
 * R4-0 Checkpoint A:乾创真实 ERP 导出数据审计(先审计,后改 Schema)。
 *
 * 用法:pnpm uat:qianchuang:analyze <fixture-dir>
 *
 * 输出:
 * - docs/customer-feedback/qianchuang/R4_REAL_DATA_AUDIT.md —— **脱敏聚合**:
 *   只含行数/列名/基数/覆盖率等统计,不含任何真实客户/供应商/物料具体值;
 * - <fixture-dir>/uat-package-manifest.json —— 私有(文件角色/SHA256/行列数);
 * - <fixture-dir>/reconciliation-report.json —— 私有(跨文件对账明细)。
 *
 * 安全纪律(R4 §4):原始 Excel 与两个 json 都在 customer-private 目录,
 * 永不 commit;本脚本 stdout 不打印任何真实数据行。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { manufacturerAliases, normalizeManufacturer } from "../../../lib/providers/common/mpn";

// ---------------- 文件角色 ----------------

type FileRole =
  | "MATERIAL"
  | "INVENTORY"
  | "EXCESS"
  | "SUPPLIER"
  | "CUSTOMER"
  | "PURCHASE_ORDER"
  | "MATERIAL_MFG";

const ROLE_PATTERNS: [FileRole, RegExp][] = [
  ["MATERIAL_MFG", /MFG维护/],
  ["MATERIAL", /^物料_/],
  ["INVENTORY", /即时库存/],
  ["EXCESS", /EXCESS/i],
  ["SUPPLIER", /^供应商/],
  ["CUSTOMER", /^客户/],
  ["PURCHASE_ORDER", /采购订单/],
];

/** 期望规模(来自任务书;实测偏差在报告中如实列出) */
const EXPECTED_ROWS: Record<FileRole, number | null> = {
  MATERIAL: 16209,
  INVENTORY: 4455,
  EXCESS: 1569,
  SUPPLIER: 629,
  CUSTOMER: 201,
  PURCHASE_ORDER: 638,
  MATERIAL_MFG: null, // 第 7 文件,任务书未给出预期行数
};

function detectRole(fileName: string): FileRole | null {
  for (const [role, re] of ROLE_PATTERNS) {
    if (re.test(fileName)) return role;
  }
  return null;
}

// ---------------- 解析 ----------------

interface SheetAudit {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  duplicateHeaders: string[];
  rowCount: number;
  columnCount: number;
  /** 每列空白率(0-1,保留 3 位) */
  blankRatio: Record<string, number>;
}

interface FileAudit {
  role: FileRole;
  fileName: string;
  sha256: string;
  bytes: number;
  sheets: SheetAudit[];
  /** 主 sheet 的数据行(供跨文件对账;只在内存与私有 json,不进 md) */
  rows: Record<string, string>[];
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in (v as object)) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in (v as object)) return String((v as { result: unknown }).result ?? "");
    if ("text" in (v as object)) return String((v as { text: unknown }).text ?? "");
  }
  return String(v);
}

/** 找表头行:前 5 行里非空单元格最多的一行(金蝶导出常有标题/过滤行前缀) */
function findHeaderRow(ws: ExcelJS.Worksheet): number {
  let best = 1;
  let bestCount = 0;
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    let count = 0;
    row.eachCell({ includeEmpty: false }, () => count++);
    if (count > bestCount) {
      bestCount = count;
      best = r;
    }
  }
  return best;
}

async function auditFile(dir: string, fileName: string, role: FileRole): Promise<FileAudit> {
  const full = path.join(dir, fileName);
  const buf = readFileSync(full);
  const sha256 = createHash("sha256").update(buf).digest("hex");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const sheets: SheetAudit[] = [];
  let mainRows: Record<string, string>[] = [];

  for (const ws of wb.worksheets) {
    if (ws.rowCount === 0) continue;
    const headerRowIndex = findHeaderRow(ws);
    const headerRow = ws.getRow(headerRowIndex);
    const headers: string[] = [];
    const colIndexes: number[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      headers.push(cellText(cell.value).trim());
      colIndexes.push(col);
    });

    // 重复表头(R4 §38 前身:PO 有两个「备注」)—— 内部编号 备注#1/备注#2,不覆盖
    const seen = new Map<string, number>();
    const dup: string[] = [];
    const uniqueHeaders = headers.map((h) => {
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      if (n === 2) dup.push(h);
      return n === 1 ? h : `${h}#${n}`;
    });

    const rows: Record<string, string>[] = [];
    const blankCounts = new Array(uniqueHeaders.length).fill(0);
    for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const record: Record<string, string> = {};
      let nonEmpty = 0;
      uniqueHeaders.forEach((h, i) => {
        const v = cellText(row.getCell(colIndexes[i]).value).trim();
        record[h] = v;
        if (v === "") blankCounts[i]++;
        else nonEmpty++;
      });
      if (nonEmpty === 0) continue; // 尾部全空行
      rows.push(record);
    }

    const blankRatio: Record<string, number> = {};
    uniqueHeaders.forEach((h, i) => {
      blankRatio[h] = rows.length ? Number((blankCounts[i] / rows.length).toFixed(3)) : 0;
    });

    sheets.push({
      sheetName: ws.name,
      headerRowIndex,
      headers: uniqueHeaders,
      duplicateHeaders: dup,
      rowCount: rows.length,
      columnCount: uniqueHeaders.length,
      blankRatio,
    });
    if (rows.length > mainRows.length) mainRows = rows;
  }

  return { role, fileName, sha256, bytes: buf.length, sheets, rows: mainRows };
}

// ---------------- 语义统计 ----------------

const norm = (v: string | undefined) => (v ?? "").trim();
const key = (v: string | undefined) => norm(v).toUpperCase();

function cardinality(pairs: [string, string][]): {
  leftUnique: number;
  rightUnique: number;
  leftToMultiRight: number;
  rightToMultiLeft: number;
  pairCount: number;
} {
  const l2r = new Map<string, Set<string>>();
  const r2l = new Map<string, Set<string>>();
  for (const [l, r] of pairs) {
    if (!l || !r) continue;
    if (!l2r.has(l)) l2r.set(l, new Set());
    l2r.get(l)!.add(r);
    if (!r2l.has(r)) r2l.set(r, new Set());
    r2l.get(r)!.add(l);
  }
  return {
    leftUnique: l2r.size,
    rightUnique: r2l.size,
    leftToMultiRight: [...l2r.values()].filter((s) => s.size > 1).length,
    rightToMultiLeft: [...r2l.values()].filter((s) => s.size > 1).length,
    pairCount: pairs.filter(([l, r]) => l && r).length,
  };
}

/** 制造商原始串按现有 normalizeManufacturer 聚类(评估现有归一化的覆盖能力) */
function mfgClusters(rawNames: string[]) {
  const clusters = new Map<string, Set<string>>();
  let emptyOrJunk = 0;
  const junkPattern = /^(#N\/?A?|N\/?A|0|-|无|\/)$/i;
  for (const raw of rawNames) {
    const t = norm(raw);
    if (!t || junkPattern.test(t)) {
      emptyOrJunk++;
      continue;
    }
    const aliases = manufacturerAliases(t);
    const k = aliases[0] ?? normalizeManufacturer(t) ?? t.toUpperCase();
    if (!clusters.has(k)) clusters.set(k, new Set());
    clusters.get(k)!.add(t);
  }
  const multi = [...clusters.entries()].filter(([, v]) => v.size > 1);
  return {
    rawUnique: new Set(rawNames.map(norm).filter(Boolean)).size,
    emptyOrJunk,
    clusterCount: clusters.size,
    clustersWithVariants: multi.length,
    variantExampleCount: multi.reduce((a, [, v]) => a + v.size, 0),
  };
}

// ---------------- 主流程 ----------------

async function main() {
  const dir = process.argv[2] ?? process.env.QIANCHUANG_UAT_FIXTURE_DIR;
  if (!dir || !existsSync(dir)) {
    console.error("用法:pnpm uat:qianchuang:analyze <fixture-dir>(或设 QIANCHUANG_UAT_FIXTURE_DIR)");
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"));
  const byRole = new Map<FileRole, string>();
  const unrecognized: string[] = [];
  for (const f of files) {
    const role = detectRole(f);
    if (role) {
      if (byRole.has(role)) console.warn(`[warn] 角色 ${role} 出现多个文件,取第一个`);
      else byRole.set(role, f);
    } else unrecognized.push(f);
  }

  const audits = new Map<FileRole, FileAudit>();
  for (const [role, f] of byRole) {
    process.stdout.write(`解析 ${role} …\n`);
    audits.set(role, await auditFile(dir, f, role));
  }

  const missingRoles = (Object.keys(EXPECTED_ROWS) as FileRole[]).filter((r) => !byRole.has(r));

  // ---- 语义统计(仅对存在的文件) ----
  const mat = audits.get("MATERIAL");
  const inv = audits.get("INVENTORY");
  const exc = audits.get("EXCESS");
  const sup = audits.get("SUPPLIER");
  const cus = audits.get("CUSTOMER");
  const po = audits.get("PURCHASE_ORDER");
  const mfg = audits.get("MATERIAL_MFG");

  const matCodes = new Set((mat?.rows ?? []).map((r) => key(r["编码"])).filter(Boolean));
  const matCustomerPn = (mat?.rows ?? [])
    .map((r) => [key(r["Customer PN"]), key(r["编码"])] as [string, string])
    .filter(([c]) => c);
  const customerPnCard = cardinality(matCustomerPn);
  const materialNoMpnNote =
    mat && !mat.sheets[0]?.headers.some((h) => /MPN|MFG/i.test(h))
      ? "Material Master 无任何 MPN/MFG 列(实测确认)"
      : mat
        ? "⚠ Material Master 出现了 MPN/MFG 类列,与任务书前提不符"
        : "文件缺失";

  const invOwnerTypes = new Map<string, number>();
  for (const r of inv?.rows ?? []) {
    const t = norm(r["货主类型"]) || "(空)";
    invOwnerTypes.set(t, (invOwnerTypes.get(t) ?? 0) + 1);
  }
  const invMatHit = (inv?.rows ?? []).filter((r) => matCodes.has(key(r["物料编码"]))).length;

  const excMatHit = (exc?.rows ?? []).filter((r) => matCodes.has(key(r["物料编码"]))).length;

  const supplierNames = new Set((sup?.rows ?? []).flatMap((r) => [key(r["名称"]), key(r["简称"])]).filter(Boolean));
  const customerNames = new Set((cus?.rows ?? []).flatMap((r) => [key(r["名称"]), key(r["简称"])]).filter(Boolean));

  const poRows = po?.rows ?? [];
  const poSupplierRaw = new Set(poRows.map((r) => key(r["供应商"])).filter(Boolean));
  const poSupplierUnresolved = [...poSupplierRaw].filter((s) => !supplierNames.has(s));
  const poMatHit = poRows.filter((r) => matCodes.has(key(r["物料编码"]))).length;

  const invCustomerOwners = new Set(
    (inv?.rows ?? [])
      .filter((r) => norm(r["货主类型"]) === "客户")
      .map((r) => key(r["货主名称"]))
      .filter(Boolean),
  );
  const invOwnerUnresolved = [...invCustomerOwners].filter((c) => !customerNames.has(c));

  // PO 内的 internalPn ↔ MFG_PN(第 7 文件缺失时的替代证据源)
  const poMfgPairs = poRows
    .map((r) => [key(r["物料编码"]), key(r["MFG_PN"])] as [string, string])
    .filter(([a, b]) => a && b);
  const poMfgCard = cardinality(poMfgPairs);
  const poMfgPnBlank = poRows.filter((r) => !norm(r["MFG_PN"])).length;
  const poMfgClusters = mfgClusters(poRows.map((r) => r["MFG"] ?? ""));

  // MFG 维护单(如存在)
  let mfgStats: Record<string, unknown> | null = null;
  if (mfg) {
    const pairs = mfg.rows
      .map((r) => [key(r["物料代码"] ?? r["物料编码"]), key(r["MFG_PN"])] as [string, string])
      .filter(([a, b]) => a && b);
    const card = cardinality(pairs);
    const clusters = mfgClusters(mfg.rows.map((r) => r["MFG"] ?? ""));
    const pcbByName = mfg.rows.filter((r) => /PCB/i.test(norm(r["物料名称"]))).length;
    const pcbByPrefix = mfg.rows.filter((r) => /^PCB-/i.test(norm(r["MFG_PN"]))).length;
    const wildcard = mfg.rows.filter((r) => norm(r["MFG_PN"]).includes("*")).length;
    const hitMaterial = pairs.filter(([c]) => matCodes.has(c)).length;
    mfgStats = { cardinality: card, mfgClusters: clusters, pcbByName, pcbByPrefix, wildcard, rowsHitMaterialMaster: hitMaterial };
  }

  // PCB 初步识别(Material 名称)
  const matPcbByName = (mat?.rows ?? []).filter((r) => /PCB/i.test(norm(r["名称"]))).length;

  // MaterialKind 一级证据:料号类型 列(实测发现,比名称匹配强)
  const matKindDist = new Map<string, number>();
  for (const r of mat?.rows ?? []) {
    const t = norm(r["料号类型"]) || "(空)";
    matKindDist.set(t, (matKindDist.get(t) ?? 0) + 1);
  }
  const matAttrDist = new Map<string, number>();
  for (const r of mat?.rows ?? []) {
    const t = norm(r["物料属性"]) || "(空)";
    matAttrDist.set(t, (matAttrDist.get(t) ?? 0) + 1);
  }

  // 未命中编码的形态诊断:与命中编码模式是否一致(判别"键格式问题"vs"导出口径缺料")
  const shape = (v: string) => v.toUpperCase().replace(/[A-Z]/g, "A").replace(/[0-9]/g, "9").slice(0, 20);
  const shapeSet = (vals: string[]) => new Set(vals.map(shape));
  const invMissCodes = (inv?.rows ?? []).map((r) => key(r["物料编码"])).filter((c) => c && !matCodes.has(c));
  const invHitCodes = (inv?.rows ?? []).map((r) => key(r["物料编码"])).filter((c) => c && matCodes.has(c));
  const invMissShapesOverlap = [...shapeSet(invMissCodes)].filter((s) => shapeSet(invHitCodes).has(s)).length;

  // ---- 与预期规模核对 ----
  const scale: { role: FileRole; expected: number | null; actual: number | null; deltaPct: string }[] = [];
  for (const role of Object.keys(EXPECTED_ROWS) as FileRole[]) {
    const a = audits.get(role);
    const actual = a ? a.rows.length : null;
    const expected = EXPECTED_ROWS[role];
    const deltaPct =
      expected && actual !== null ? `${(((actual - expected) / expected) * 100).toFixed(1)}%` : "—";
    scale.push({ role, expected, actual, deltaPct });
  }
  const majorMismatch = scale.filter(
    (s) => s.expected !== null && s.actual !== null && Math.abs(s.actual - s.expected) / s.expected > 0.05,
  );

  // ---- 私有 manifest ----
  const manifest = {
    generatedAt: new Date().toISOString(),
    fixtureDir: dir,
    files: [...audits.values()].map((a) => ({
      role: a.role,
      fileName: a.fileName,
      sha256: a.sha256,
      bytes: a.bytes,
      sheets: a.sheets.map(({ sheetName, headerRowIndex, headers, duplicateHeaders, rowCount, columnCount }) => ({
        sheetName,
        headerRowIndex,
        headers,
        duplicateHeaders,
        rowCount,
        columnCount,
      })),
    })),
    missingRoles,
    unrecognizedFiles: unrecognized,
  };
  writeFileSync(path.join(dir, "uat-package-manifest.json"), JSON.stringify(manifest, null, 2));

  const reconciliation = {
    generatedAt: new Date().toISOString(),
    materialCodes: matCodes.size,
    inventory: {
      rows: inv?.rows.length ?? null,
      hitMaterialMaster: invMatHit,
      ownerTypes: Object.fromEntries(invOwnerTypes),
      customerOwnersUnique: invCustomerOwners.size,
      customerOwnersUnresolved: invOwnerUnresolved.length,
      unresolvedOwnerSamples: invOwnerUnresolved.slice(0, 20), // 私有文件内允许
    },
    excess: { rows: exc?.rows.length ?? null, hitMaterialMaster: excMatHit },
    purchaseOrder: {
      rows: poRows.length,
      hitMaterialMaster: poMatHit,
      suppliersUnique: poSupplierRaw.size,
      suppliersUnresolved: poSupplierUnresolved.length,
      unresolvedSupplierSamples: poSupplierUnresolved.slice(0, 20), // 私有文件内允许
      mfgPnBlankRows: poMfgPnBlank,
      internalPnMfgPnCardinality: poMfgCard,
      mfgNormalization: poMfgClusters,
    },
    customerPnCardinality: customerPnCard,
    materialMfgFile: mfgStats,
  };
  writeFileSync(path.join(dir, "reconciliation-report.json"), JSON.stringify(reconciliation, null, 2));

  // ---- 脱敏审计报告(可提交) ----
  const outDir = path.join(process.cwd(), "docs/customer-feedback/qianchuang");
  mkdirSync(outDir, { recursive: true });
  const md: string[] = [];
  md.push("# R4 REAL DATA AUDIT(乾创真实 ERP 导出 · 脱敏聚合)");
  md.push("");
  md.push(`> 生成:${new Date().toISOString().slice(0, 16).replace("T", " ")} · 工具 scripts/uat/qianchuang/analyze.ts`);
  md.push("> 本文件只含**聚合统计与列名**,不含任何真实客户/供应商/物料具体值;");
  md.push("> 明细在私有目录的 uat-package-manifest.json / reconciliation-report.json(不入库)。");
  md.push("");
  md.push("## 1. 文件清单与规模核对");
  md.push("");
  md.push("| 角色 | 实测行数 | 任务书预期 | 偏差 | 列数 | 重复表头 |");
  md.push("|---|---|---|---|---|---|");
  for (const s of scale) {
    const a = audits.get(s.role);
    md.push(
      `| ${s.role} | ${s.actual ?? "**缺失**"} | ${s.expected ?? "—"} | ${s.deltaPct} | ${a?.sheets[0]?.columnCount ?? "—"} | ${a?.sheets[0]?.duplicateHeaders.join("、") || "无"} |`,
    );
  }
  md.push("");
  if (missingRoles.length) {
    md.push(`**缺失文件角色**:${missingRoles.join("、")} —— 相关审计维度标 BLOCKED_DATA,待客户提供后重跑本工具。`);
    md.push("");
  }
  if (unrecognized.length) md.push(`未识别文件:${unrecognized.length} 个(角色模式未命中,见私有 manifest)。`);
  md.push("");
  md.push("## 2. 各文件表头(实测)");
  md.push("");
  for (const a of audits.values()) {
    const s = a.sheets[0];
    md.push(`### ${a.role}(sheet「${s.sheetName}」,表头行 ${s.headerRowIndex})`);
    md.push("");
    md.push(s.headers.map((h) => `\`${h}\``).join(" · "));
    md.push("");
    const highBlank = Object.entries(s.blankRatio).filter(([, v]) => v >= 0.5);
    if (highBlank.length) {
      md.push(`空白率 ≥50% 的列:${highBlank.map(([h, v]) => `\`${h}\`(${(v * 100).toFixed(0)}%)`).join("、")}`);
      md.push("");
    }
  }
  md.push("## 3. 身份体系实测(R4 v2 核心前提验证)");
  md.push("");
  md.push(`- **Material Master 与 MPN**:${materialNoMpnNote};唯一物料编码 ${matCodes.size}`);
  md.push(`- **Customer PN 多义性**:有 Customer PN 的物料对 ${customerPnCard.pairCount};` +
    `一个 Customer PN → 多个内部编码:${customerPnCard.rightToMultiLeft > 0 ? "" : ""}${customerPnCard.leftToMultiRight} 个;` +
    `一个内部编码 → 多个 Customer PN:${customerPnCard.rightToMultiLeft} 个`);
  md.push(`- **Material 名称含 PCB**:${matPcbByName} 行`);
  md.push(`- **料号类型 分布(MaterialKind 一级证据源,实测发现)**:${[...matKindDist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(";")}`);
  md.push(`- **物料属性 分布**:${[...matAttrDist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(";")}`);
  md.push("");
  md.push("### PO 中的 Internal PN ↔ MFG_PN(历史证据源)");
  md.push("");
  md.push(`- PO 行数 ${poRows.length};MFG_PN 为空 ${poMfgPnBlank} 行(合法,不报错)`);
  md.push(`- 有效 (物料编码, MFG_PN) 对 ${poMfgCard.pairCount};唯一内部编码 ${poMfgCard.leftUnique};唯一 MFG_PN ${poMfgCard.rightUnique}`);
  md.push(`- 一个内部编码 → 多个 MFG_PN:**${poMfgCard.leftToMultiRight}** 个;一个 MFG_PN → 多个内部编码:**${poMfgCard.rightToMultiLeft}** 个(多对多实测成立与否看此两数)`);
  md.push("");
  md.push("### 制造商原始串(PO.MFG)归一化评估");
  md.push("");
  md.push(`- 原始唯一串 ${poMfgClusters.rawUnique};空/垃圾值(#N、NA、0、-)${poMfgClusters.emptyOrJunk} 行`);
  md.push(`- 现有 normalizeManufacturer 聚类后 ${poMfgClusters.clusterCount} 组;含多写法变体的组 ${poMfgClusters.clustersWithVariants} 个`);
  md.push("");
  if (mfgStats) {
    md.push("### 物料 MFG 维护单(第 7 文件)");
    md.push("");
    md.push("```json");
    md.push(JSON.stringify(mfgStats, null, 2));
    md.push("```");
    md.push("");
  } else {
    md.push("### 物料 MFG 维护单(第 7 文件)");
    md.push("");
    md.push("**BLOCKED_DATA:本机未找到该文件** —— Internal PN ↔ MFG 多对多的正式证据、PCB/元器件分类分布、");
    md.push("MFG 归一化全量评估,均待此文件到位后重跑 analyzer 补齐。当前仅有 PO 历史证据可用。");
    md.push("");
  }
  md.push("## 4. 跨文件对账(Referential Integrity 实测)");
  md.push("");
  md.push("| 检查 | 结果 |");
  md.push("|---|---|");
  md.push(`| Inventory.物料编码 命中 Material | ${invMatHit} / ${inv?.rows.length ?? "—"} |`);
  md.push(`| Excess.物料编码 命中 Material | ${excMatHit} / ${exc?.rows.length ?? "—"} |`);
  md.push(`| PO.物料编码 命中 Material | ${poMatHit} / ${poRows.length} |`);
  md.push(`| Inventory 货主类型分布 | ${[...invOwnerTypes.entries()].map(([k, v]) => `${k}:${v}`).join(";")} |`);
  md.push(`| 货主=客户 的唯一货主名 | ${invCustomerOwners.size},其中 **${invOwnerUnresolved.length} 个无法匹配客户主数据**(脱敏不一致,待 alias override) |`);
  md.push(`| PO 唯一供应商名 | ${poSupplierRaw.size},其中 **${poSupplierUnresolved.length} 个无法匹配供应商主数据** |`);
  md.push("");
  md.push(
    `> 未命中编码形态诊断:Inventory 未命中 ${invMissCodes.length} 个编码的形态与命中集重叠 ${invMissShapesOverlap} 种 —— ` +
      "形态一致说明**不是键格式问题,而是物料主数据导出口径不含这些料**(真实数据特征);" +
      "按 UNRESOLVED_MATERIAL 如实登记,不自动补造物料。",
  );
  md.push("");
  md.push("> 未命中不自动补造关系(R4 §58);STRICT_UAT 下为 UNRESOLVED_REFERENCE,由私有 uat-reference-overrides.json 人工解决。");
  md.push("");
  md.push("## 5. 结构一致性结论");
  md.push("");
  if (majorMismatch.length === 0 && missingRoles.length <= 1) {
    md.push("除上述缺失文件外,实测结构与任务书假设**一致**(行数偏差均 ≤5%),可以按 R4 v2 计划进入 Schema 设计。");
  } else {
    md.push("⚠ 实测与任务书假设存在明显不一致,**STOP:先解决以下差异再写 importer**:");
    for (const s of majorMismatch) md.push(`- ${s.role}:预期 ${s.expected},实测 ${s.actual}(${s.deltaPct})`);
    for (const r of missingRoles) md.push(`- 文件缺失:${r}`);
  }
  md.push("");
  writeFileSync(path.join(outDir, "R4_REAL_DATA_AUDIT.md"), md.join("\n"));

  process.stdout.write(`\n完成:${audits.size} 个文件已审计;缺失角色 ${missingRoles.length} 个。\n`);
  process.stdout.write(`- 脱敏报告:docs/customer-feedback/qianchuang/R4_REAL_DATA_AUDIT.md\n`);
  process.stdout.write(`- 私有 manifest/reconciliation:${dir}\n`);
  if (majorMismatch.length) {
    process.stdout.write(`⚠ 规模偏差超 5% 的角色:${majorMismatch.map((m) => m.role).join("、")} —— 见报告 §5\n`);
    process.exitCode = 2;
  }
}

void main();
