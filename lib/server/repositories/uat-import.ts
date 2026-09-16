/**
 * R4-4(§35):UAT Package 原子持久化。
 *
 * 全部写入在**一个 prisma 事务**内(禁止半套数据);顺序:
 * Customer → Supplier → Part(+CUSTOMER_PN_UNSCOPED 标识)→ PartMfgMapping
 * → InventorySnapshot → ExcessSnapshot/Line → PO 的 MFG 证据 → 批次记录。
 *
 * 不补造纪律:
 * - 主数据外的物料:mfg/PO 证据行**跳过并计数**;inventory/excess 行保留
 *   (partId 空 + internalPn 原文),不造 Part;
 * - 业务组织货主 customerId 恒空;客户货主解析不上时 customerId 空 + 原始名保留;
 * - PO 单据本体不在本 PR 落库(归 R4-8 的 ERP PO 语义),只产 PO_HISTORY 证据。
 * 审计:一批次一条 AuditLog(计数聚合,零真实数据行)。
 */
import type { Prisma } from "@prisma/client";
import { PO_HISTORY_DEFAULTS, mfgMaintenanceDefaults } from "@/lib/domain/part-mfg";
import type { UatPackagePlan } from "@/lib/integration/erp/uat-package";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { upsertMfgEvidence } from "@/lib/server/repositories/part-mfg-mapping";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

const key = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

export interface UatImportResult {
  ok: boolean;
  datasetVersion: string;
  counts: Record<string, number>;
  reason?: string;
}

export async function commitUatPackage(
  session: SessionRef,
  plan: UatPackagePlan,
  overrides: { customers: Record<string, string>; suppliers: Record<string, string> } | null,
): Promise<UatImportResult> {
  if (!plan.admissible) {
    return {
      ok: false,
      datasetVersion: plan.datasetVersion,
      counts: {},
      reason: plan.rejectReasons.join(";"),
    };
  }
  const tenantId = session.tenantId;
  const existing = await prisma.erpUatImportBatch.findUnique({
    where: { tenantId_datasetVersion: { tenantId, datasetVersion: plan.datasetVersion } },
  });
  if (existing) {
    return {
      ok: false,
      datasetVersion: plan.datasetVersion,
      counts: {},
      reason: `datasetVersion ${plan.datasetVersion} 已导入过(§39 可重复校验:同包重放被幂等拒绝)`,
    };
  }

  const { settings } = await getTenantSettings(tenantId);
  const mfgDefaults = mfgMaintenanceDefaults(settings.erpMfgMaintenanceAsApproved);

  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  await prisma.$transaction(
    async (tx) => {
      // ---- Customer / Supplier(按编码 upsert;不猜名称) ----
      for (const c of plan.data.customers.records) {
        const found = await tx.customer.findFirst({
          where: tenantWhere(tenantId, { code: c.customerCode }),
          select: { id: true },
        });
        if (found) {
          await tx.customer.update({ where: { id: found.id }, data: { name: c.name } });
          bump("customerUpdated");
        } else {
          await tx.customer.create({ data: tenantData(tenantId, { code: c.customerCode, name: c.name }) });
          bump("customerCreated");
        }
      }
      for (const s of plan.data.suppliers.records) {
        const found = await tx.supplier.findFirst({
          where: tenantWhere(tenantId, { code: s.supplierCode }),
          select: { id: true },
        });
        if (found) {
          await tx.supplier.update({
            where: { id: found.id },
            data: { name: s.name, isActive: s.disabled === true ? false : true },
          });
          bump("supplierUpdated");
        } else {
          await tx.supplier.create({
            data: tenantData(tenantId, {
              code: s.supplierCode,
              name: s.name,
              isActive: s.disabled === true ? false : true,
            }),
          });
          bump("supplierCreated");
        }
      }

      // ---- Part(internalPn upsert;origin=IMPORTED;无 MPN 合法 §6) ----
      const partIdByPn = new Map<string, string>();
      const existingParts = await tx.part.findMany({
        where: tenantWhere(tenantId, {}),
        select: { id: true, internalPn: true },
      });
      for (const p of existingParts) partIdByPn.set(key(p.internalPn), p.id);

      const toCreate: Prisma.PartUncheckedCreateInput[] = [];
      for (const m of plan.data.materials.records) {
        const k = key(m.internalPn);
        const existingId = partIdByPn.get(k);
        const common = {
          description: m.name,
          note: m.specification,
          msl: m.msl,
          materialKind: m.materialKind as never,
          materialKindSource: m.materialKindSource,
          materialKindConfidence: m.materialKindConfidence,
          status: (m.disabled === true ? "INACTIVE" : "ACTIVE") as never,
        };
        if (existingId) {
          await tx.part.update({ where: { id: existingId }, data: common });
          bump("partUpdated");
        } else {
          toCreate.push({
            ...tenantData(tenantId, {
              internalPn: m.internalPn,
              origin: "IMPORTED" as never,
              sourcedFrom: "OFFLINE" as never,
              ...common,
            }),
          });
        }
      }
      // createMany 批量(16K 规模;不逐行 create)
      for (let i = 0; i < toCreate.length; i += 2000) {
        await tx.part.createMany({ data: toCreate.slice(i, i + 2000) });
      }
      bump("partCreated", toCreate.length);
      const created = await tx.part.findMany({
        where: tenantWhere(tenantId, {}),
        select: { id: true, internalPn: true },
      });
      partIdByPn.clear();
      for (const p of created) partIdByPn.set(key(p.internalPn), p.id);

      // Customer PN(无 customerId)→ PartIdentifier CUSTOMER_PN_UNSCOPED(§24)
      const identRows: Prisma.PartIdentifierUncheckedCreateInput[] = [];
      const seenIdent = new Set(
        (
          await tx.partIdentifier.findMany({
            where: tenantWhere(tenantId, { type: "CUSTOMER_PN_UNSCOPED" }),
            select: { partId: true, value: true },
          })
        ).map((x) => `${x.partId}|${key(x.value)}`),
      );
      for (const m of plan.data.materials.records) {
        if (!m.customerPnUnscoped) continue;
        const partId = partIdByPn.get(key(m.internalPn));
        if (!partId) continue;
        const dk = `${partId}|${key(m.customerPnUnscoped)}`;
        if (seenIdent.has(dk)) continue;
        seenIdent.add(dk);
        identRows.push(
          tenantData(tenantId, { partId, type: "CUSTOMER_PN_UNSCOPED", value: m.customerPnUnscoped }),
        );
      }
      for (let i = 0; i < identRows.length; i += 2000) {
        await tx.partIdentifier.createMany({ data: identRows.slice(i, i + 2000), skipDuplicates: true });
      }
      bump("customerPnUnscoped", identRows.length);

      // ---- PartMfgMapping(维护单;主数据外跳过并计数,不补造) ----
      for (const m of plan.data.materialMfg.records) {
        const partId = partIdByPn.get(key(m.internalPn));
        if (!partId) {
          bump("mfgMappingSkippedOrphan");
          continue;
        }
        const r = await upsertMfgEvidence(tx, tenantId, {
          partId,
          rawManufacturer: m.rawManufacturer,
          rawManufacturerPartNo: m.rawManufacturerPartNo,
          materialKind: inferKindFromIdentifier(m.identifierKind),
          identifierKind: m.identifierKind,
          identifierMatchMode: m.identifierMatchMode,
          ...mfgDefaults,
          sourceDocumentNo: m.sourceDocumentNo,
          sourceLineId: m.sourceLineId,
          sourceRow: m.sourceRow,
          sourceCreatedAt: m.sourceCreatedAt,
        });
        bump(r.created ? "mfgMappingCreated" : "mfgMappingDeduped");
      }

      // ---- Inventory(行全保留;owner 语义 §33) ----
      const customerIdByCode = new Map(
        (
          await tx.customer.findMany({ where: tenantWhere(tenantId, {}), select: { id: true, code: true, name: true } })
        ).flatMap((c) => [
          [key(c.code), c.id],
          [key(c.name), c.id],
        ] as [string, string][]),
      );
      const overrideCustomer = new Map(
        Object.entries(overrides?.customers ?? {}).map(([n, code]) => [key(n), key(code)]),
      );
      const now = new Date();
      const invRows: Prisma.InventorySnapshotUncheckedCreateInput[] = [];
      for (const r of plan.data.inventory.records) {
        const partId = partIdByPn.get(key(r.internalPn)) ?? null;
        if (!partId) bump("inventoryOrphanKept");
        let customerId: string | null = null;
        if (r.ownerType === "CUSTOMER") {
          const direct = customerIdByCode.get(key(r.ownerNameRaw));
          const viaOverride = overrideCustomer.has(key(r.ownerNameRaw))
            ? customerIdByCode.get(overrideCustomer.get(key(r.ownerNameRaw))!)
            : undefined;
          customerId = direct ?? viaOverride ?? null;
          bump(customerId ? "inventoryOwnerResolved" : "inventoryOwnerUnresolved");
        }
        invRows.push(
          tenantData(tenantId, {
            partId,
            internalPn: r.internalPn,
            qtyOnHand: r.onHandQty,
            availableQty: null, // §33:未知,绝不 = onHand
            reservedQty: null,
            warehouse: r.warehouseName,
            lotNo: r.lotNo,
            unit: r.unit,
            ownerType: r.ownerType,
            ownerNameRaw: r.ownerNameRaw,
            customerId,
            importBatchId: plan.datasetVersion,
            fetchedAt: now,
          }),
        );
      }
      for (let i = 0; i < invRows.length; i += 2000) {
        await tx.inventorySnapshot.createMany({ data: invRows.slice(i, i + 2000) });
      }
      bump("inventoryRows", invRows.length);

      // ---- Excess(§34) ----
      const snapshot = await tx.excessSnapshot.create({
        data: tenantData(tenantId, {
          source: "ERP" as never,
          snapshotAt: now,
          sourceDocumentId: plan.files.find((f) => f.role === "EXCESS")?.fileName ?? null,
          importedAt: now,
          note: `UAT 包 ${plan.datasetVersion}`,
          createdById: session.userId,
          importJobId: plan.datasetVersion,
        }),
      });
      const excessRows: Prisma.ExcessLineUncheckedCreateInput[] = [];
      for (const r of plan.data.excess.records) {
        const qty = r.excessQtyExclOpo;
        if (qty === null) {
          bump("excessSkippedNoQty");
          continue;
        }
        const customerId =
          customerIdByCode.get(key(r.customerNameRaw)) ??
          (overrideCustomer.has(key(r.customerNameRaw))
            ? customerIdByCode.get(overrideCustomer.get(key(r.customerNameRaw))!)
            : undefined) ??
          null;
        excessRows.push(
          tenantData(tenantId, {
            snapshotId: snapshot.id,
            customerId,
            partId: partIdByPn.get(key(r.internalPn)) ?? null,
            internalPn: r.internalPn,
            qty,
            availableQty: qty, // 源无更细锁定信息;占用与否由 PM 人工确认(既有语义)
            lastBusinessAt: r.lastBusinessAt ? new Date(r.lastBusinessAt) : null,
            excessQtyInclOpo: r.excessQtyInclOpo,
            moq: r.moq,
            standardUnitPrice: r.standardUnitPrice,
            customerNameRaw: r.customerNameRaw,
            customerPnRaw: r.customerPnRaw,
          }),
        );
      }
      for (let i = 0; i < excessRows.length; i += 2000) {
        await tx.excessLine.createMany({ data: excessRows.slice(i, i + 2000) });
      }
      bump("excessRows", excessRows.length);

      // ---- R4-9(§49/§50):ERP PO 单据落库(source=ERP_IMPORT) ----
      // 供应商名经 主数据/alias override 解析;解析不上的单据整单跳过并计数
      // (supplierId 是必填外键 —— 不造占位供应商,待 override 补齐后重导)
      const supplierIdByName = new Map<string, string>();
      for (const su of await tx.supplier.findMany({
        where: tenantWhere(tenantId, {}),
        select: { id: true, name: true, code: true },
      })) {
        supplierIdByName.set(key(su.name), su.id);
        supplierIdByName.set(key(su.code), su.id);
      }
      const overrideSupplier = new Map(
        Object.entries(overrides?.suppliers ?? {}).map(([n, code]) => [key(n), key(code)]),
      );
      const poByNumber = new Map<string, typeof plan.data.purchaseOrders.records>();
      for (const r of plan.data.purchaseOrders.records) {
        poByNumber.set(r.erpPoNumber, [...(poByNumber.get(r.erpPoNumber) ?? []), r]);
      }
      for (const [erpPoNumber, poLines] of poByNumber) {
        const supRaw = key(poLines[0].supplierNameRaw);
        const supplierId =
          supplierIdByName.get(supRaw) ??
          (overrideSupplier.has(supRaw) ? supplierIdByName.get(overrideSupplier.get(supRaw)!) : undefined);
        if (!supplierId) {
          bump("erpPoSkippedUnresolvedSupplier");
          continue;
        }
        const existingPo = await tx.purchaseOrder.findFirst({
          where: tenantWhere(tenantId, { erpPoNumber }),
          select: { id: true },
        });
        if (existingPo) {
          bump("erpPoDeduped");
          continue; // 同 ERP 单号已导入(幂等)
        }
        const po = await tx.purchaseOrder.create({
          data: tenantData(tenantId, {
            poNo: `ERP-${erpPoNumber}`,
            supplierId,
            currency: "CNY",
            status: "EXPORTED" as never, // 历史单:已在 ERP 成立;不走内部审批机
            source: "ERP_IMPORT",
            erpPoNumber,
            erpOrderDate: poLines[0].orderDate ? new Date(poLines[0].orderDate) : null,
            erpDocStatus: poLines[0].docStatus,
            erpCloseStatus: poLines[0].closeStatus,
            createdById: session.userId,
          }),
        });
        for (const l of poLines) {
          await tx.purchaseOrderLine.create({
            data: tenantData(tenantId, {
              purchaseOrderId: po.id,
              lineNo: l.sourceLineNo,
              partId: partIdByPn.get(key(l.internalPn)) ?? null,
              mpn: l.rawManufacturerPartNo,
              manufacturer: l.rawManufacturer,
              description: l.materialName,
              qty: l.qty ?? "0",
              unitPrice: l.unitPrice,
              currency: "CNY",
              requestedDeliveryDate: l.requestedDeliveryDate ? new Date(l.requestedDeliveryDate) : null,
              sourceLineNo: l.sourceLineNo,
              sourceRow: l.sourceRow,
              erpReceivedQty: l.receivedQty,
              erpMaterialReceivedQty: l.materialReceivedQty,
              erpRemainingQty: l.remainingQty,
              isGift: l.isGift,
              remark1: l.remark1,
              remark2: l.remark2,
            }),
          });
          bump("erpPoLines");
        }
        bump("erpPoCreated");
      }

      // ---- PO → MFG 证据(§22;PO 单据本体见上) ----
      const kindByPnForPo = new Map(
        plan.data.materials.records.map((m) => [key(m.internalPn), m.materialKind]),
      );
      for (const r of plan.data.purchaseOrders.records) {
        if (!r.rawManufacturerPartNo) continue;
        const partId = partIdByPn.get(key(r.internalPn));
        if (!partId) {
          bump("poEvidenceSkippedOrphan");
          continue;
        }
        // PO 行的标识种类跟随该料的 MaterialKind(PCB 采购行 → PCB_PART_NO,不当元器件 MPN)
        const kindRec = kindByPnForPo.get(key(r.internalPn));
        const materialKind = kindRec ?? "OTHER";
        const identifierKind = identifierKindForKind(materialKind);
        const res = await upsertMfgEvidence(tx, tenantId, {
          partId,
          rawManufacturer: r.rawManufacturer,
          rawManufacturerPartNo: r.rawManufacturerPartNo,
          materialKind,
          identifierKind,
          identifierMatchMode: r.rawManufacturerPartNo.includes("*") ? "PATTERN" : "EXACT",
          ...PO_HISTORY_DEFAULTS,
          sourceDocumentNo: r.erpPoNumber,
          sourceRow: r.sourceRow,
          sourceCreatedAt: r.orderDate,
        });
        bump(res.created ? "poEvidenceCreated" : "poEvidenceDeduped");
      }

      // ---- 批次记录 + 审计 ----
      await tx.erpUatImportBatch.create({
        data: tenantData(tenantId, {
          datasetVersion: plan.datasetVersion,
          profileId: plan.profileId,
          mode: plan.mode,
          fileManifest: plan.files as unknown as Prisma.InputJsonValue,
          counts: counts as unknown as Prisma.InputJsonValue,
          reconciliation: plan.reconciliation as unknown as Prisma.InputJsonValue,
          aliasOverrideHash: plan.aliasOverrideHash,
          createdById: session.userId,
        }),
      });
      await writeAudit(tx, {
        tenantId,
        userId: session.userId,
        action: "ERP_UAT_PACKAGE_IMPORT",
        entityType: "ErpUatImportBatch",
        entityId: plan.datasetVersion,
        after: { mode: plan.mode, counts, reconciliation: plan.reconciliation },
      });
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  return { ok: true, datasetVersion: plan.datasetVersion, counts };
}

function identifierKindForKind(
  kind: "ELECTRONIC_COMPONENT" | "PCB_BARE_BOARD" | "MECHANICAL" | "CABLE" | "ASSEMBLY" | "CONSUMABLE" | "OTHER",
) {
  switch (kind) {
    case "ELECTRONIC_COMPONENT":
      return "COMPONENT_MPN" as const;
    case "PCB_BARE_BOARD":
      return "PCB_PART_NO" as const;
    case "MECHANICAL":
      return "MECHANICAL_PART_NO" as const;
    case "ASSEMBLY":
      return "ASSEMBLY_PART_NO" as const;
    default:
      return "OTHER" as const;
  }
}

function inferKindFromIdentifier(
  k: "COMPONENT_MPN" | "PCB_PART_NO" | "MECHANICAL_PART_NO" | "ASSEMBLY_PART_NO" | "VENDOR_PART_NO" | "OTHER",
) {
  switch (k) {
    case "COMPONENT_MPN":
      return "ELECTRONIC_COMPONENT" as const;
    case "PCB_PART_NO":
      return "PCB_BARE_BOARD" as const;
    case "MECHANICAL_PART_NO":
      return "MECHANICAL" as const;
    case "ASSEMBLY_PART_NO":
      return "ASSEMBLY" as const;
    default:
      return "OTHER" as const;
  }
}
