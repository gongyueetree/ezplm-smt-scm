/**
 * R4-6(§30/§31):供应商采购策略仓储(复用 PartSupplierRef 扩展字段)。
 * 批量维护:Excel 导出/导入 → Preview(校验+冲突)→ Confirm(事务)→ Audit。
 * 唯一性(tenant, part, supplier, mfgMapping?)由应用层 upsert 保证
 * (PG 复合唯一对 NULL 视为互异)。
 */
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

const HEADERS = [
  "内部料号",
  "供应商编码",
  "MFG_PN(可选,件级策略)",
  "优先级",
  "首选",
  "认可",
  "拉黑",
  "MOQ",
  "SPQ",
  "货期天数",
  "配额百分比",
  "生效自",
  "失效至",
  "备注",
] as const;

export async function listStrategies(session: SessionRef, partId?: string) {
  return prisma.partSupplierRef.findMany({
    where: tenantWhere(session.tenantId, partId ? { partId } : {}),
    include: { part: { select: { internalPn: true } } },
    orderBy: [{ isBlocked: "asc" }, { priority: "asc" }],
    take: 500,
  });
}

/** 导出当前策略为 Excel(供批量编辑回传) */
export async function exportStrategiesXlsx(session: SessionRef): Promise<Buffer> {
  const rows = await prisma.partSupplierRef.findMany({
    where: tenantWhere(session.tenantId, {}),
    include: {
      part: { select: { internalPn: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const suppliers = new Map(
    (
      await prisma.supplier.findMany({ where: tenantWhere(session.tenantId, {}), select: { id: true, code: true } })
    ).map((s) => [s.id, s.code]),
  );
  const mfg = new Map(
    (
      await prisma.partMfgMapping.findMany({
        where: tenantWhere(session.tenantId, {}),
        select: { id: true, manufacturerPartNo: true },
      })
    ).map((m) => [m.id, m.manufacturerPartNo]),
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("供应商策略");
  ws.addRow([...HEADERS]);
  for (const r of rows) {
    ws.addRow([
      r.part.internalPn,
      suppliers.get(r.supplierId) ?? r.supplierId,
      r.partMfgMappingId ? (mfg.get(r.partMfgMappingId) ?? "") : "",
      r.priority,
      r.isPreferred ? "是" : "否",
      r.isApproved ? "是" : "否",
      r.isBlocked ? "是" : "否",
      r.moq?.toString() ?? "",
      r.spq?.toString() ?? "",
      r.leadTimeDays ?? "",
      r.allocationPercent?.toString() ?? "",
      r.effectiveFrom?.toISOString().slice(0, 10) ?? "",
      r.effectiveTo?.toISOString().slice(0, 10) ?? "",
      r.note ?? "",
    ]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface StrategyImportRow {
  row: number;
  internalPn: string;
  supplierCode: string;
  mfgPn: string | null;
  priority: number;
  isPreferred: boolean;
  isApproved: boolean;
  isBlocked: boolean;
  moq: string | null;
  spq: string | null;
  leadTimeDays: number | null;
  allocationPercent: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  note: string | null;
  issues: string[];
  /** 解析出的落库目标(preview 时填充) */
  resolved?: { partId: string; supplierId: string; partMfgMappingId: string | null; exists: boolean };
}

export interface StrategyImportPreview {
  rows: StrategyImportRow[];
  valid: number;
  invalid: number;
  creates: number;
  updates: number;
  conflicts: string[];
}

const yes = (v: string) => /^(是|Y|YES|TRUE|1)$/i.test(v.trim());

export async function previewStrategyImport(
  session: SessionRef,
  fileBuf: Buffer,
): Promise<StrategyImportPreview> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("空工作簿");

  const rows: StrategyImportRow[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return; // 表头
    const cell = (i: number) => String(row.getCell(i).value ?? "").trim();
    const issues: string[] = [];
    const num = (v: string, field: string): string | null => {
      if (!v) return null;
      if (!/^\d+(\.\d+)?$/.test(v)) {
        issues.push(`${field} 非法数值「${v}」`);
        return null;
      }
      return v;
    };
    const date = (v: string, field: string): string | null => {
      if (!v) return null;
      if (Number.isNaN(Date.parse(v))) {
        issues.push(`${field} 非法日期「${v}」`);
        return null;
      }
      return v;
    };
    const internalPn = cell(1);
    const supplierCode = cell(2);
    if (!internalPn) issues.push("内部料号必填");
    if (!supplierCode) issues.push("供应商编码必填");
    const pr = cell(4);
    rows.push({
      row: n,
      internalPn,
      supplierCode,
      mfgPn: cell(3) || null,
      priority: pr && /^\d+$/.test(pr) ? Number(pr) : 100,
      isPreferred: yes(cell(5)),
      isApproved: yes(cell(6)),
      isBlocked: yes(cell(7)),
      moq: num(cell(8), "MOQ"),
      spq: num(cell(9), "SPQ"),
      leadTimeDays: cell(10) && /^\d+$/.test(cell(10)) ? Number(cell(10)) : null,
      allocationPercent: num(cell(11), "配额"),
      effectiveFrom: date(cell(12), "生效自"),
      effectiveTo: date(cell(13), "失效至"),
      note: cell(14) || null,
      issues,
    });
  });

  // 解析引用(定向 IN 查询)
  const pns = [...new Set(rows.map((r) => r.internalPn).filter(Boolean))];
  const codes = [...new Set(rows.map((r) => r.supplierCode).filter(Boolean))];
  const [parts, suppliers] = await Promise.all([
    prisma.part.findMany({
      where: tenantWhere(session.tenantId, { internalPn: { in: pns } }),
      select: { id: true, internalPn: true },
    }),
    prisma.supplier.findMany({
      where: tenantWhere(session.tenantId, { code: { in: codes } }),
      select: { id: true, code: true },
    }),
  ]);
  const partByPn = new Map(parts.map((p) => [p.internalPn.toUpperCase(), p.id]));
  const supByCode = new Map(suppliers.map((s) => [s.code.toUpperCase(), s.id]));
  const partIds = parts.map((p) => p.id);
  const mappings = partIds.length
    ? await prisma.partMfgMapping.findMany({
        where: tenantWhere(session.tenantId, { partId: { in: partIds } }),
        select: { id: true, partId: true, manufacturerPartNoKey: true },
      })
    : [];
  const mfgByPartAndKey = new Map(mappings.map((m) => [`${m.partId}|${m.manufacturerPartNoKey}`, m.id]));
  const existing = partIds.length
    ? await prisma.partSupplierRef.findMany({
        where: tenantWhere(session.tenantId, { partId: { in: partIds } }),
        select: { partId: true, supplierId: true, partMfgMappingId: true },
      })
    : [];
  const existSet = new Set(existing.map((e) => `${e.partId}|${e.supplierId}|${e.partMfgMappingId ?? ""}`));

  const conflicts: string[] = [];
  const seen = new Set<string>();
  const norm = (v: string) => v.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const r of rows) {
    const partId = partByPn.get(r.internalPn.toUpperCase());
    const supplierId = supByCode.get(r.supplierCode.toUpperCase());
    if (!partId) r.issues.push(`内部料号不存在:${r.internalPn}`);
    if (!supplierId) r.issues.push(`供应商编码不存在:${r.supplierCode}`);
    let partMfgMappingId: string | null = null;
    if (r.mfgPn && partId) {
      partMfgMappingId = mfgByPartAndKey.get(`${partId}|${norm(r.mfgPn)}`) ?? null;
      if (!partMfgMappingId) r.issues.push(`该料没有 MFG 件「${r.mfgPn}」的映射(件级策略必须先有映射)`);
    }
    if (r.isPreferred && r.isBlocked) r.issues.push("首选与拉黑不能同时为是");
    if (partId && supplierId) {
      const k = `${partId}|${supplierId}|${partMfgMappingId ?? ""}`;
      if (seen.has(k)) {
        r.issues.push("文件内重复行(同料+同供应商+同作用域)");
        conflicts.push(`第 ${r.row} 行与前行重复`);
      }
      seen.add(k);
      r.resolved = { partId, supplierId, partMfgMappingId, exists: existSet.has(k) };
    }
  }
  const valid = rows.filter((r) => r.issues.length === 0).length;
  return {
    rows,
    valid,
    invalid: rows.length - valid,
    creates: rows.filter((r) => r.issues.length === 0 && r.resolved && !r.resolved.exists).length,
    updates: rows.filter((r) => r.issues.length === 0 && r.resolved?.exists).length,
    conflicts,
  };
}

/** Confirm:仅落有效行;任何 invalid 存在时要求 force 不允许 —— 全绿才可提交(策略是采购决策依据) */
export async function commitStrategyImport(
  session: SessionRef,
  preview: StrategyImportPreview,
): Promise<{ ok: true; created: number; updated: number } | { ok: false; reason: string }> {
  if (preview.invalid > 0) {
    return { ok: false, reason: `存在 ${preview.invalid} 行校验失败 —— 修正后重新上传(策略导入不允许部分成功)` };
  }
  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of preview.rows) {
      if (!r.resolved) continue;
      const data = {
        priority: r.priority,
        isPreferred: r.isPreferred,
        isApproved: r.isApproved,
        isBlocked: r.isBlocked,
        moq: r.moq,
        spq: r.spq,
        leadTimeDays: r.leadTimeDays,
        allocationPercent: r.allocationPercent,
        effectiveFrom: r.effectiveFrom ? new Date(r.effectiveFrom) : null,
        effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
        note: r.note,
      } satisfies Prisma.PartSupplierRefUpdateInput;
      const found = await tx.partSupplierRef.findFirst({
        where: tenantWhere(session.tenantId, {
          partId: r.resolved.partId,
          supplierId: r.resolved.supplierId,
          partMfgMappingId: r.resolved.partMfgMappingId,
        }),
        select: { id: true },
      });
      if (found) {
        await tx.partSupplierRef.update({ where: { id: found.id }, data });
        updated++;
      } else {
        await tx.partSupplierRef.create({
          data: tenantData(session.tenantId, {
            partId: r.resolved.partId,
            supplierId: r.resolved.supplierId,
            partMfgMappingId: r.resolved.partMfgMappingId,
            createdById: session.userId,
            ...data,
          }) as Prisma.PartSupplierRefUncheckedCreateInput,
        });
        created++;
      }
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "SUPPLIER_STRATEGY_BULK_IMPORT",
      entityType: "PartSupplierRef",
      entityId: "bulk",
      after: { created, updated, rows: preview.rows.length },
    });
  });
  return { ok: true, created, updated };
}
