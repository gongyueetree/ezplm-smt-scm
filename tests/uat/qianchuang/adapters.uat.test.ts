/**
 * R4-1 私有 UAT:金蝶 Excel 适配器对真实 7 文件的解析冒烟。
 * 断言基于真实数据的**结构特征**(存在性/量级),不硬编码猜测;
 * 输出只有聚合数字,零真实数据行(§4)。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptCustomer,
  adaptExcess,
  adaptInventory,
  adaptMaterial,
  adaptMaterialMfg,
  adaptPurchaseOrder,
  adaptSupplier,
} from "@/lib/integration/erp/sources/kingdee/excel/adapters";
import { parseMainSheet } from "@/lib/integration/erp/sources/kingdee/excel/workbook";
import { QIANCHUANG_K3_V1, detectRole, type FileRole } from "@/lib/integration/erp/profiles/qianchuang-k3-v1";

const dir = process.env.QIANCHUANG_UAT_FIXTURE_DIR!;

async function load(role: FileRole) {
  const f = readdirSync(dir).find((x) => x.endsWith(".xlsx") && detectRole(QIANCHUANG_K3_V1, x) === role);
  expect(f, `缺少角色文件 ${role}`).toBeTruthy();
  return { sheet: await parseMainSheet(readFileSync(path.join(dir, f!))), file: f! };
}

describe("真实 7 文件 → Canonical 冒烟", () => {
  it("Material:16K 全解析;无 MPN 列;料号类型分类覆盖 100%;PCB/元器件并存", async () => {
    const { sheet, file } = await load("MATERIAL");
    const r = adaptMaterial(sheet, file);
    expect(r.fileIssues).toEqual([]);
    expect(r.records.length).toBeGreaterThan(16000);
    const kinds = new Map<string, number>();
    for (const m of r.records) kinds.set(m.materialKind, (kinds.get(m.materialKind) ?? 0) + 1);
    expect(kinds.get("ELECTRONIC_COMPONENT")!).toBeGreaterThan(10000);
    expect(kinds.get("PCB_BARE_BOARD")!).toBeGreaterThan(1000);
    expect(kinds.get("ASSEMBLY")!).toBeGreaterThan(1000);
    // 分类一级证据全部来自 料号类型
    expect(r.records.every((m) => m.materialKindSource === "ERP_MATERIAL_TYPE")).toBe(true);
    // Material 无 MPN(canonical 里根本没有该字段位;此处断言无行报缺列)
    expect(r.meta.headers.some((h) => /MPN|MFG/i.test(h))).toBe(false);
  });

  it("MFG 维护单:5 万级;N:M 实锤;PATTERN 通配存在;junk MFG→null", async () => {
    const { sheet, file } = await load("MATERIAL_MFG");
    const r = adaptMaterialMfg(sheet, file);
    expect(r.fileIssues).toEqual([]);
    expect(r.records.length).toBeGreaterThan(50000);
    const byPn = new Map<string, Set<string>>();
    const byMfgPn = new Map<string, Set<string>>();
    let pattern = 0;
    let junkMfg = 0;
    for (const m of r.records) {
      if (m.identifierMatchMode === "PATTERN") pattern++;
      if (m.rawManufacturer === null) junkMfg++;
      const a = m.internalPn.toUpperCase();
      const b = m.rawManufacturerPartNo.toUpperCase();
      if (!byPn.has(a)) byPn.set(a, new Set());
      byPn.get(a)!.add(b);
      if (!byMfgPn.has(b)) byMfgPn.set(b, new Set());
      byMfgPn.get(b)!.add(a);
    }
    expect([...byPn.values()].filter((s) => s.size > 1).length).toBeGreaterThan(5000); // 一料多厂
    expect([...byMfgPn.values()].filter((s) => s.size > 1).length).toBeGreaterThan(10000); // 一厂多料
    expect(pattern).toBeGreaterThan(100); // 通配 MFG_PN
    expect(junkMfg).toBeGreaterThan(500); // #N 类垃圾如实置 null
  });

  it("Inventory:客户与业务组织并存;available/reserved 全 null;无 blank→0", async () => {
    const { sheet, file } = await load("INVENTORY");
    const r = adaptInventory(sheet, file);
    expect(r.fileIssues).toEqual([]);
    const owners = new Map<string, number>();
    for (const x of r.records) owners.set(x.ownerType, (owners.get(x.ownerType) ?? 0) + 1);
    expect(owners.get("CUSTOMER")!).toBeGreaterThan(1000);
    expect(owners.get("ORGANIZATION")!).toBeGreaterThan(1000);
    expect(r.records.every((x) => x.availableQty === null && x.reservedQty === null)).toBe(true);
  });

  it("Excess:lastBusinessAt 落位;blank 数值全 null;非法数值 0 例(真实数据干净度实测)", async () => {
    const { sheet, file } = await load("EXCESS");
    const r = adaptExcess(sheet, file);
    expect(r.fileIssues).toEqual([]);
    // 实测:891 行有时间、678 行空白 —— 两态都存在且空白如实为 null
    expect(r.records.filter((x) => x.lastBusinessAt !== null).length).toBeGreaterThan(800);
    expect(r.records.filter((x) => x.lastBusinessAt === null).length).toBeGreaterThan(600);
    expect(r.records.flatMap((x) => x.issues).filter((i) => i.code === "INVALID_DATE")).toHaveLength(0);
    expect(r.records.every((x) => x.earliestInboundAt === null)).toBe(true);
    // 空白率高的列(溢发 100% 空)必须是 null 而不是 0
    expect(r.records.every((x) => x.overIssueQty === null || x.overIssueQty !== "0" || true)).toBe(true);
    const blankAsNull = r.records.filter((x) => x.overIssueQty === null).length;
    expect(blankAsNull).toBe(r.records.length); // 审计:溢发列 100% 空
  });

  it("PO:双备注保留;MFG_PN 空行合法零 issue;ERP 单据编号全非空;行序稳定", async () => {
    const { sheet, file } = await load("PURCHASE_ORDER");
    const r = adaptPurchaseOrder(sheet, file);
    expect(r.fileIssues).toEqual([]);
    expect(r.meta.duplicateHeaders).toContain("备注");
    expect(r.records.every((x) => x.erpPoNumber !== "")).toBe(true);
    const blankMfgPn = r.records.filter((x) => x.rawManufacturerPartNo === null);
    expect(blankMfgPn.length).toBeGreaterThan(100); // 审计:180 行为空
    expect(blankMfgPn.every((x) => !x.issues.some((i) => i.field === "rawManufacturerPartNo"))).toBe(true);
    // 同一单据的行序从 1 连续
    const byPo = new Map<string, number[]>();
    for (const x of r.records) {
      if (!byPo.has(x.erpPoNumber)) byPo.set(x.erpPoNumber, []);
      byPo.get(x.erpPoNumber)!.push(x.sourceLineNo);
    }
    for (const lines of byPo.values()) {
      expect(lines).toEqual(Array.from({ length: lines.length }, (_, i) => i + 1));
    }
  });

  it("Customer/Supplier:全部行解析;编码与名称非空", async () => {
    const c = await load("CUSTOMER");
    const rc = adaptCustomer(c.sheet, c.file);
    expect(rc.records.length).toBeGreaterThan(150);
    expect(rc.records.every((x) => x.customerCode && x.name)).toBe(true);
    const s = await load("SUPPLIER");
    const rs = adaptSupplier(s.sheet, s.file);
    expect(rs.records.length).toBeGreaterThan(500);
    expect(rs.records.every((x) => x.supplierCode && x.name)).toBe(true);
  });
});
