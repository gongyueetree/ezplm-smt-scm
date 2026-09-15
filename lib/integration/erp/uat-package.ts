/**
 * R4-4(§35/§39):乾创 UAT Package —— 7 文件整包解析/校验/对账/计划。
 *
 * 本模块**不写库**:产出 UatPackagePlan(计划 + 全部计数 + 行级问题聚合),
 * 持久化由 lib/server/repositories/uat-import.ts 在单事务内原子执行。
 * 纪律:
 * - 全部 Validation 先完成,任何文件级错误 → 整包拒绝(不允许半套数据);
 * - STRICT_UAT:任何 INVALID_DECIMAL/INVALID_DATE/MISSING_REQUIRED → 整包拒绝;
 *   UNRESOLVED_REFERENCE(脱敏不一致/导出口径缺料)**不拒包**——如实计数报告,
 *   由 alias override 与客户补充导出解决(审计已证实其为数据固有特征);
 * - 不补造:主数据外的物料 → 行保留(inventory)或跳过并计数(mfg 映射/PO 证据);
 *   业务组织绝不当客户;供应商/客户名不做 fuzzy 自动映射(§58)。
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type {
  AdapterResult,
  CanonicalCustomer,
  CanonicalExcess,
  CanonicalInventory,
  CanonicalMaterial,
  CanonicalMaterialMfg,
  CanonicalPurchaseOrderLine,
  CanonicalRecord,
  CanonicalSupplier,
} from "./canonical/types";
import { classifyMaterialKind } from "./normalization/material-kind";
import {
  adaptCustomer,
  adaptExcess,
  adaptInventory,
  adaptMaterial,
  adaptMaterialMfg,
  adaptPurchaseOrder,
  adaptSupplier,
} from "./sources/kingdee/excel/adapters";
import { parseMainSheet } from "./sources/kingdee/excel/workbook";
import { QIANCHUANG_K3_V1, detectRole, type FileRole } from "./profiles/qianchuang-k3-v1";

export type ImportMode = "STRICT_UAT" | "DEMO_LENIENT";

/** 私有 alias override(§16 v1):脱敏名 → 主数据编码;不入库不入 git */
export interface ReferenceOverrides {
  customers: Record<string, string>;
  suppliers: Record<string, string>;
}

export interface UatPackagePlan {
  datasetVersion: string;
  profileId: string;
  mode: ImportMode;
  files: { role: FileRole; fileName: string; sha256: string; rows: number }[];
  data: {
    customers: AdapterResult<CanonicalCustomer>;
    suppliers: AdapterResult<CanonicalSupplier>;
    materials: AdapterResult<CanonicalMaterial>;
    materialMfg: AdapterResult<CanonicalMaterialMfg>;
    inventory: AdapterResult<CanonicalInventory>;
    excess: AdapterResult<CanonicalExcess>;
    purchaseOrders: AdapterResult<CanonicalPurchaseOrderLine>;
  };
  reconciliation: {
    materialCodes: number;
    mfgRowsHitMaterial: number;
    mfgRowsOrphan: number;
    inventoryRowsHitMaterial: number;
    inventoryRowsOrphan: number;
    inventoryCustomerOwnersUnique: number;
    inventoryCustomerOwnersResolved: number;
    inventoryCustomerOwnersUnresolved: number;
    excessRowsHitMaterial: number;
    excessCustomerNamesUnique: number;
    excessCustomerNamesResolved: number;
    poRowsHitMaterial: number;
    poMfgEvidenceRows: number;
    poSuppliersUnique: number;
    poSuppliersResolved: number;
  };
  /** 行级问题聚合:code → 条数(STRICT 拒包判定依据;不含真实数据行) */
  issueCounts: Record<string, number>;
  fileIssues: { role: FileRole; issues: string[] }[];
  aliasOverrideHash: string | null;
  /** STRICT 下是否可提交 */
  admissible: boolean;
  rejectReasons: string[];
}

const IMPORT_ORDER: FileRole[] = [
  "CUSTOMER",
  "SUPPLIER",
  "MATERIAL",
  "MATERIAL_MFG",
  "INVENTORY",
  "EXCESS",
  "PURCHASE_ORDER",
];

export function loadReferenceOverrides(fixtureDir: string): ReferenceOverrides | null {
  const p = path.join(fixtureDir, "uat-reference-overrides.json");
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<ReferenceOverrides>;
  return { customers: raw.customers ?? {}, suppliers: raw.suppliers ?? {} };
}

const key = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

export async function buildUatPackagePlan(
  fixtureDir: string,
  mode: ImportMode,
): Promise<UatPackagePlan> {
  const profile = QIANCHUANG_K3_V1;
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"));
  const byRole = new Map<FileRole, string>();
  for (const f of files) {
    const role = detectRole(profile, f);
    if (role && !byRole.has(role)) byRole.set(role, f);
  }
  const missing = IMPORT_ORDER.filter((r) => !byRole.has(r));
  if (missing.length) {
    throw new Error(`UAT 包不完整,缺角色:${missing.join("、")} —— 整包拒绝(§35)`);
  }

  const buffers = new Map<FileRole, { fileName: string; buf: Buffer; sha256: string }>();
  for (const [role, fileName] of byRole) {
    const buf = readFileSync(path.join(fixtureDir, fileName));
    buffers.set(role, { fileName, buf, sha256: createHash("sha256").update(buf).digest("hex") });
  }

  const sheet = async (role: FileRole) => parseMainSheet(buffers.get(role)!.buf);
  const customers = adaptCustomer(await sheet("CUSTOMER"), buffers.get("CUSTOMER")!.fileName);
  const suppliers = adaptSupplier(await sheet("SUPPLIER"), buffers.get("SUPPLIER")!.fileName);
  const materials = adaptMaterial(await sheet("MATERIAL"), buffers.get("MATERIAL")!.fileName);
  // MFG 映射的 MaterialKind 用主数据一级证据(料号类型)
  const kindByPn = new Map(
    materials.records.map((m) => [
      key(m.internalPn),
      { materialKind: m.materialKind, source: m.materialKindSource, confidence: m.materialKindConfidence },
    ]),
  );
  const materialMfg = adaptMaterialMfg(
    await sheet("MATERIAL_MFG"),
    buffers.get("MATERIAL_MFG")!.fileName,
    kindByPn as Parameters<typeof adaptMaterialMfg>[2],
  );
  const inventory = adaptInventory(await sheet("INVENTORY"), buffers.get("INVENTORY")!.fileName);
  const excess = adaptExcess(await sheet("EXCESS"), buffers.get("EXCESS")!.fileName);
  const purchaseOrders = adaptPurchaseOrder(
    await sheet("PURCHASE_ORDER"),
    buffers.get("PURCHASE_ORDER")!.fileName,
  );

  const overrides = loadReferenceOverrides(fixtureDir);
  const aliasOverrideHash = overrides
    ? createHash("sha256").update(JSON.stringify(overrides)).digest("hex").slice(0, 12)
    : null;

  // ---- 跨文件对账 ----
  const matCodes = new Set(materials.records.map((m) => key(m.internalPn)));
  const customerByName = new Map<string, string>(); // 主数据名/简称 → code
  for (const c of customers.records) {
    customerByName.set(key(c.name), c.customerCode);
    if (c.shortName) customerByName.set(key(c.shortName), c.customerCode);
  }
  for (const [name, code] of Object.entries(overrides?.customers ?? {})) {
    customerByName.set(key(name), code);
  }
  const supplierByName = new Map<string, string>();
  for (const s of suppliers.records) {
    supplierByName.set(key(s.name), s.supplierCode);
    if (s.shortName) supplierByName.set(key(s.shortName), s.supplierCode);
  }
  for (const [name, code] of Object.entries(overrides?.suppliers ?? {})) {
    supplierByName.set(key(name), code);
  }

  const mfgHit = materialMfg.records.filter((m) => matCodes.has(key(m.internalPn))).length;
  const invHit = inventory.records.filter((r) => matCodes.has(key(r.internalPn))).length;
  const invCustomerOwners = new Set(
    inventory.records.filter((r) => r.ownerType === "CUSTOMER").map((r) => key(r.ownerNameRaw)),
  );
  invCustomerOwners.delete("");
  const invOwnersResolved = [...invCustomerOwners].filter((n) => customerByName.has(n)).length;
  const excessHit = excess.records.filter((r) => matCodes.has(key(r.internalPn))).length;
  const excessCustomers = new Set(excess.records.map((r) => key(r.customerNameRaw)));
  excessCustomers.delete("");
  const excessResolved = [...excessCustomers].filter((n) => customerByName.has(n)).length;
  const poHit = purchaseOrders.records.filter((r) => matCodes.has(key(r.internalPn))).length;
  const poMfgEvidence = purchaseOrders.records.filter(
    (r) => r.rawManufacturerPartNo && matCodes.has(key(r.internalPn)),
  ).length;
  const poSuppliers = new Set(purchaseOrders.records.map((r) => key(r.supplierNameRaw)));
  poSuppliers.delete("");
  const poSuppliersResolved = [...poSuppliers].filter((n) => supplierByName.has(n)).length;

  // ---- 行级问题聚合与 STRICT 判定 ----
  const issueCounts: Record<string, number> = {};
  const all: AdapterResult<CanonicalRecord>[] = [
    customers,
    suppliers,
    materials,
    materialMfg,
    inventory,
    excess,
    purchaseOrders,
  ];
  for (const r of all) {
    for (const rec of r.records) {
      for (const i of rec.issues) issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
    }
  }
  const fileIssues = IMPORT_ORDER.map((role) => ({
    role,
    issues: (
      { CUSTOMER: customers, SUPPLIER: suppliers, MATERIAL: materials, MATERIAL_MFG: materialMfg, INVENTORY: inventory, EXCESS: excess, PURCHASE_ORDER: purchaseOrders } as const
    )[role].fileIssues,
  })).filter((f) => f.issues.length > 0);

  const rejectReasons: string[] = [];
  if (fileIssues.length) {
    rejectReasons.push(`文件级错误:${fileIssues.map((f) => `${f.role}(${f.issues.join(";")})`).join(" / ")}`);
  }
  if (mode === "STRICT_UAT") {
    for (const code of ["INVALID_DECIMAL", "INVALID_DATE", "MISSING_REQUIRED", "UNKNOWN_ENUM"]) {
      if (issueCounts[code]) rejectReasons.push(`STRICT_UAT:存在 ${code} × ${issueCounts[code]},整包拒绝`);
    }
  }

  // datasetVersion:业务日期(文件名里的日期)+ 内容哈希
  const bizDate = /(\d{8})/.exec(buffers.get("MATERIAL")!.fileName)?.[1]?.slice(0, 8) ?? "00000000";
  const contentHash = createHash("sha256");
  for (const role of IMPORT_ORDER) contentHash.update(buffers.get(role)!.sha256);
  if (aliasOverrideHash) contentHash.update(aliasOverrideHash);
  const datasetVersion = `QCUAT-${bizDate}-${contentHash.digest("hex").slice(0, 6)}`;

  return {
    datasetVersion,
    profileId: profile.id,
    mode,
    files: IMPORT_ORDER.map((role) => ({
      role,
      fileName: buffers.get(role)!.fileName,
      sha256: buffers.get(role)!.sha256,
      rows: (
        { CUSTOMER: customers, SUPPLIER: suppliers, MATERIAL: materials, MATERIAL_MFG: materialMfg, INVENTORY: inventory, EXCESS: excess, PURCHASE_ORDER: purchaseOrders } as const
      )[role].records.length,
    })),
    data: { customers, suppliers, materials, materialMfg, inventory, excess, purchaseOrders },
    reconciliation: {
      materialCodes: matCodes.size,
      mfgRowsHitMaterial: mfgHit,
      mfgRowsOrphan: materialMfg.records.length - mfgHit,
      inventoryRowsHitMaterial: invHit,
      inventoryRowsOrphan: inventory.records.length - invHit,
      inventoryCustomerOwnersUnique: invCustomerOwners.size,
      inventoryCustomerOwnersResolved: invOwnersResolved,
      inventoryCustomerOwnersUnresolved: invCustomerOwners.size - invOwnersResolved,
      excessRowsHitMaterial: excessHit,
      excessCustomerNamesUnique: excessCustomers.size,
      excessCustomerNamesResolved: excessResolved,
      poRowsHitMaterial: poHit,
      poMfgEvidenceRows: poMfgEvidence,
      poSuppliersUnique: poSuppliers.size,
      poSuppliersResolved: poSuppliersResolved,
    },
    issueCounts,
    fileIssues,
    aliasOverrideHash,
    admissible: rejectReasons.length === 0,
    rejectReasons,
  };
}

/** classifyMaterialKind 的返回形状复用(供 orchestrator 消费方类型推导) */
export type MaterialKindResult = ReturnType<typeof classifyMaterialKind>;
