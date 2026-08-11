/**
 * PM 端采购申请单(Backlog B1;整合方案 3.2)。
 * GTB 计算全过程落 gtbSnapshot,供审计与复核;同 MPN 呆滞库存一并提示。
 */
import type { Prisma } from "@prisma/client";
import { calculateGtb, type GtbResult } from "@/lib/domain/gtb";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";
import { Decimal } from "decimal.js";
import { getExcessProvider } from "@/lib/providers/excess/factory";
import { splitExcessByOwnership } from "@/lib/providers/excess";

async function nextCode(tenantId: string, now: Date): Promise<string> {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `PR-${stamp}-`;
  const last = await prisma.purchaseRequest.findFirst({
    where: tenantWhere(tenantId, { code: { startsWith: prefix } }),
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const seq = last ? Number(last.code.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(seq) ? seq : 0) + 1).padStart(3, "0")}`;
}

export interface CreatePurchaseRequestInput {
  mpn: string;
  demandQty: number;
  scrapRate?: string | null;
  moq?: number | null;
  spq?: number | null;
  note?: string | null;
  /* ---- PR2-PROC-05:客户点名要在申请行上看到的字段 ---- */
  internalPn?: string | null;
  manufacturer?: string | null;
  requiredDate?: string | null;
  customerId?: string | null;
  projectCode?: string | null;
  /**
   * PM 确认要占用的 Excess 数量。
   * **只有 PM 在页面上显式确认后才会传值** —— 系统不自动占用(尤其不跨客户)。
   */
  excessQty?: number | null;
}

export interface PurchaseRequestPreview {
  gtb: GtbResult;
  /** Excess 可用性;数据源未接入时 unavailableReason 非空,页面据此显示未配置 */
  excess: {
    unavailableReason: string | null;
    snapshotAt: string | null;
    usableQty: string | null;
    otherCustomerQty: string | null;
  };
  /** 同 MPN 呆滞数量提示(整合方案 3.2) */
  slowMovingQty: number | null;
  stockQty: number;
  inTransitQty: number;
}

/** 取库存与在途:ezPLM 为真源,本地是只读缓存 */
export async function previewGtb(
  tenantId: string,
  input: CreatePurchaseRequestInput,
): Promise<PurchaseRequestPreview> {
  const part = await prisma.part.findFirst({
    where: tenantWhere(tenantId, { mpn: input.mpn }),
    select: { id: true },
  });

  const [inv, openPo] = await Promise.all([
    part
      ? prisma.inventorySnapshot.findFirst({
          where: tenantWhere(tenantId, { partId: part.id }),
          orderBy: { fetchedAt: "desc" },
        })
      : null,
    part
      ? prisma.openPOLine.findMany({ where: tenantWhere(tenantId, { partId: part.id }) })
      : [],
  ]);

  const stockQty = inv ? Number(inv.qtyOnHand) : 0;
  const inTransitQty = openPo.reduce((sum, l) => sum + Number(l.qtyOpen), 0);

  /*
   * Excess 可用性。Provider 未配置时返回空 + 原因,**不给 Mock 数字**。
   * 属于别家客户的量单列出来 —— 系统只提示,占用与否由 PM 人工确认。
   */
  const provider = await getExcessProvider();
  const lookup = await provider.lookup({
    tenantId,
    mpns: [input.mpn],
    customerId: input.customerId ?? null,
  });
  const split = splitExcessByOwnership(lookup.lines, input.customerId ?? null);
  const sumAvail = (rows: { availableQty: string }[]) =>
    rows.length === 0
      ? null
      : rows.reduce((acc, r) => acc.plus(new Decimal(r.availableQty)), new Decimal(0)).toFixed();

  return {
    excess: {
      unavailableReason: lookup.unavailableReason,
      snapshotAt: lookup.snapshotAt,
      usableQty: sumAvail(split.usable),
      otherCustomerQty: sumAvail(split.otherCustomers),
    },
    gtb: calculateGtb({
      demandQty: input.demandQty,
      scrapRate: input.scrapRate,
      stockQty,
      inTransitQty,
      // 只用 PM 显式确认的占用量;不把"可用量"当成"已占用"
      excessQty: input.excessQty ?? null,
      moq: input.moq,
      spq: input.spq,
    }),
    slowMovingQty: inv?.qtySlowMoving === null || inv?.qtySlowMoving === undefined ? null : Number(inv.qtySlowMoving),
    stockQty,
    inTransitQty,
  };
}

export async function createPurchaseRequest(
  session: SessionRef,
  input: CreatePurchaseRequestInput,
) {
  const preview = await previewGtb(session.tenantId, input);
  const code = await nextCode(session.tenantId, new Date());

  return prisma.$transaction(async (tx) => {
    const pr = await tx.purchaseRequest.create({
      data: tenantData(session.tenantId, {
        code,
        requestedById: session.userId,
        mpn: input.mpn,
        qty: preview.gtb.purchaseQty,
        /*
         * PR2-PROC-05:客户点名的字段落在行上。
         * 库存/Excess/在途/ETA 存的是**核算当时的快照值**,不随后续库存变动改写 ——
         * 否则事后翻这张单,永远解释不了"当时为什么算出这个采购量"。
         */
        internalPn: input.internalPn ?? null,
        manufacturer: input.manufacturer ?? null,
        demandQty: input.demandQty,
        requiredDate: input.requiredDate ? new Date(input.requiredDate) : null,
        customerId: input.customerId ?? null,
        projectCode: input.projectCode ?? null,
        internalInventory: preview.stockQty,
        excessQty: preview.gtb.excessApplied === null ? null : preview.gtb.excessApplied,
        openPoQty: preview.inTransitQty,
        gtbSnapshot: {
          input,
          stockQty: preview.stockQty,
          inTransitQty: preview.inTransitQty,
          slowMovingQty: preview.slowMovingQty,
          excess: preview.excess,
          result: preview.gtb,
        } as unknown as Prisma.InputJsonValue,
        status: "SUBMITTED",
        note: input.note ?? null,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PURCHASE_REQUEST_CREATE",
      entityType: "PurchaseRequest",
      entityId: pr.id,
      after: { code, mpn: input.mpn, qty: preview.gtb.purchaseQty, gtb: preview.gtb },
    });
    return pr;
  });
}

export async function listPurchaseRequests(session: SessionRef) {
  return prisma.purchaseRequest.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
