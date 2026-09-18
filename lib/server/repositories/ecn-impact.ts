/**
 * F2(T2,flag ecn.impactAnalysis):影响分析面板取数。
 *
 * 铁律(PAGE_SPEC §7 / §10):
 * - **只读**,不做任何自动动作;
 * - 每个数据源独立 try/catch —— 一个源失败其它卡照常(部分降级),
 *   `WORK_ORDER_SOURCE_UNAVAILABLE` 场景正是验证这条;
 * - 缺源显示「待接入/失败原因」,**禁止 0 或示例数**;
 * - 每卡带来源与取数时间。
 */
import { ErpNotConfiguredError, ErpNotImplementedError } from "@/lib/providers/erp";
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";
import { prisma } from "@/lib/server/db";
import { resolveErpTarget } from "@/lib/server/repositories/integration-sync";
import { tenantWhere } from "@/lib/server/tenant-scope";

/**
 * R3-5(P1-2):coverage 语义 —— 数字念出来之前先说清口径。
 * FULL=按变更料号精确过滤;HEADER_ONLY=源只有单据头,给的是全量清单
 * (数字≠受影响面,不可直接作决策依据);PARTIAL=只覆盖部分维度;
 * UNAVAILABLE=该维度本系统当前无源。
 */
export type SourceCoverage = "FULL" | "PARTIAL" | "HEADER_ONLY" | "UNAVAILABLE";

export interface SourceResult<T> {
  state: "ok" | "not_configured" | "error";
  coverage: SourceCoverage;
  /** coverage 口径的人话说明(HEADER_ONLY/PARTIAL 必填) */
  warning: string | null;
  /** 失败/未配置的人话原因 */
  note: string | null;
  fetchedAt: string | null;
  items: T[];
}

export interface EcnImpact {
  /** ERP 目标(NONE 时所有 ERP 源显示待接入) */
  erpTarget: string;
  /** 本系统数据:受影响 BOM 行 */
  affectedBoms: { bomId: string; bomName: string; versionId: string; versionNo: number; lineCount: number }[];
  oldInventory: SourceResult<{ materialCode: string; warehouse: string | null; lotNo: string | null; qty: string }>;
  newInventory: SourceResult<{ materialCode: string; warehouse: string | null; lotNo: string | null; qty: string }>;
  openPo: SourceResult<{ poNo: string; lineNo: number; mpn: string | null; qtyOrdered: string; eta: string | null }>;
  excess: SourceResult<{ materialCode: string | null; qty: string; usableQty: string | null; customerCode: string | null }>;
  workOrders: SourceResult<{ workOrderNo: string; product: string | null; plannedQty: string; status: string | null }>;
  salesOrders: SourceResult<{ soNumber: string; customerCode: string; lines: number }>;
}

const norm = (v: string | null | undefined) => normalizeMpnKey(v);

function notConfigured<T>(reason: string, coverage: SourceCoverage = "FULL", warning: string | null = null): SourceResult<T> {
  return { state: "not_configured", coverage, warning, note: reason, fetchedAt: null, items: [] };
}

async function guardedPull<T>(
  fn: () => Promise<T[]>,
  coverage: SourceCoverage,
  warning: string | null = null,
): Promise<SourceResult<T>> {
  try {
    const items = await fn();
    return { state: "ok", coverage, warning, note: null, fetchedAt: new Date().toISOString(), items };
  } catch (e) {
    if (e instanceof ErpNotConfiguredError || e instanceof ErpNotImplementedError) {
      return notConfigured(e.message, coverage, warning);
    }
    return {
      state: "error",
      coverage,
      warning,
      note: `数据源失败:${e instanceof Error ? e.message : "未知错误"} —— 其它数据源不受影响`,
      fetchedAt: new Date().toISOString(),
      items: [],
    };
  }
}

const HEADER_ONLY_WO = "工单源只有单据头(无 BOM 展开)—— 下表为**全量**在制/计划工单,数字不是受影响面,不可直接作决策依据,请工程按产品自行核对";
const HEADER_ONLY_SO = "销售订单按单据头列出(行内物料未与变更料号匹配)—— 数字不是受影响面,不可直接作决策依据";

export async function gatherEcnImpact(tenantId: string, ecnId: string): Promise<EcnImpact | null> {
  const ecn = await prisma.ecn.findFirst({
    where: tenantWhere(tenantId, { id: ecnId }),
    include: { changeLines: true },
  });
  if (!ecn) return null;

  const oldKeys = new Set(
    ecn.changeLines.flatMap((l) => [norm(l.oldMpn), norm(l.oldInternalPn)]).filter(Boolean),
  );
  const newKeys = new Set(
    ecn.changeLines.flatMap((l) => [norm(l.newMpn), norm(l.newInternalPn)]).filter(Boolean),
  );

  // 本系统:受影响 BOM(按旧料反查行)
  const bomLines = oldKeys.size
    ? await prisma.bOMLine.findMany({
        where: tenantWhere(tenantId, {}),
        select: { bomVersionId: true, mpn: true, internalPn: true },
        take: 20_000,
      })
    : [];
  const hitVersionCounts = new Map<string, number>();
  for (const l of bomLines) {
    if (oldKeys.has(norm(l.mpn)) || oldKeys.has(norm(l.internalPn))) {
      hitVersionCounts.set(l.bomVersionId, (hitVersionCounts.get(l.bomVersionId) ?? 0) + 1);
    }
  }
  const versions = hitVersionCounts.size
    ? await prisma.bOMVersion.findMany({
        where: tenantWhere(tenantId, { id: { in: [...hitVersionCounts.keys()] } }),
        include: { bom: { select: { id: true, name: true } } },
      })
    : [];
  const affectedBoms = versions.map((v) => ({
    bomId: v.bom.id,
    bomName: v.bom.name,
    versionId: v.id,
    versionNo: v.versionNo,
    lineCount: hitVersionCounts.get(v.id) ?? 0,
  }));

  const target = await resolveErpTarget(tenantId);
  if (target.kind === "NONE") {
    const na = <C extends SourceCoverage>(coverage: C, warning: string | null = null) =>
      notConfigured<never>(target.reason, coverage, warning);
    return {
      erpTarget: "NONE",
      affectedBoms,
      oldInventory: na("FULL"),
      newInventory: na("FULL"),
      openPo: na("FULL"),
      excess: na("FULL"),
      workOrders: na("HEADER_ONLY", HEADER_ONLY_WO),
      salesOrders: na("HEADER_ONLY", HEADER_ONLY_SO),
    };
  }

  const provider = target.provider; // closed-loop:必须用 target 里的租户感知实例,不得回退无租户工厂
  const cfg = target.config;
  const matchOld = (code: string | null) => oldKeys.has(norm(code));
  const matchNew = (code: string | null) => newKeys.has(norm(code));

  // 各源独立降级;并行取数
  const [oldInventory, newInventory, openPo, excess, workOrders, salesOrders] = await Promise.all([
    guardedPull(async () =>
      (await provider.pullInventory(cfg, {})).items
        .filter((i) => matchOld(i.materialCode ?? i.internalPn))
        .map((i) => ({ materialCode: i.materialCode ?? i.internalPn ?? "?", warehouse: i.warehouse, lotNo: i.lotNo, qty: i.qty })),
      "FULL",
    ),
    guardedPull(async () =>
      (await provider.pullInventory(cfg, {})).items
        .filter((i) => matchNew(i.materialCode ?? i.internalPn))
        .map((i) => ({ materialCode: i.materialCode ?? i.internalPn ?? "?", warehouse: i.warehouse, lotNo: i.lotNo, qty: i.qty })),
      "FULL",
    ),
    guardedPull(async () =>
      (await provider.pullOpenPurchaseOrders(cfg, {})).items
        .filter((p) => matchOld(p.internalPn) || matchOld(p.mpn))
        .map((p) => ({ poNo: p.poNo, lineNo: p.lineNo, mpn: p.mpn, qtyOrdered: p.qtyOrdered, eta: p.eta })),
      "FULL",
    ),
    guardedPull(async () =>
      (await provider.pullExcessReport(cfg, {})).items
        .filter((x) => matchOld(x.internalPn) || matchOld(x.mpn))
        .map((x) => ({ materialCode: x.internalPn ?? x.mpn, qty: x.qty, usableQty: x.usableQty, customerCode: x.customerCode })),
      "FULL",
    ),
    guardedPull(
      async () =>
        // 工单:LAB-1 才有 consumedLines,本 DTO 只有头 —— 头级无法按物料过滤,
        // 如实给全量在制/计划工单让工程自行核对(coverage=HEADER_ONLY 明示口径)
        (await provider.pullWorkOrders(cfg, {})).items.map((w) => ({
          workOrderNo: w.workOrderNo,
          product: w.product,
          plannedQty: w.plannedQty,
          status: w.status,
        })),
      "HEADER_ONLY",
      HEADER_ONLY_WO,
    ),
    guardedPull(
      async () =>
        (await provider.pullSalesOrders(cfg, {})).items.map((so) => ({
          soNumber: so.soNumber,
          customerCode: so.customerCode,
          lines: so.lines.length,
        })),
      "HEADER_ONLY",
      HEADER_ONLY_SO,
    ),
  ]);

  return { erpTarget: target.kind, affectedBoms, oldInventory, newInventory, openPo, excess, workOrders, salesOrders };
}
