import { notFound } from "next/navigation";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { persistedProgress } from "@/lib/domain/procurement-flags";
import { getProcurementRfq } from "@/lib/server/repositories/procurement";
import { getSession } from "@/lib/server/session";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { SourcingPanel } from "./sourcing-panel";

export const dynamic = "force-dynamic";

export default async function ProcurementRfqDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = (await getSession())!;
  const prfq = await getProcurementRfq(session, id);
  if (!prfq) notFound();

  const suppliers = await prisma.supplier.findMany({
    where: tenantWhere(session.tenantId, { isActive: true }),
    orderBy: { priority: "asc" },
    select: { id: true, code: true, name: true },
  });

  const allLines = prfq.supplierQuotes.flatMap((q) =>
    q.lines.map((l) => ({
      id: l.id,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      unitPrice: String(l.unitPrice),
      currency: l.currency,
      leadTimeDays: l.leadTimeDays,
      wasFlagged: l.wasFlagged,
      flagReasons: (l.flagReasons as { code: string; detail: string }[] | null) ?? [],
      resolution: l.resolution,
      resolutionNote: l.resolutionNote,
      selected: l.selected,
      selectionReason: l.selectionReason,
      previousLineId: l.previousLineId,
      supplierId: q.supplierId,
    })),
  );

  const progress = persistedProgress(
    allLines.map((l) => ({ lineId: l.id, wasFlagged: l.wasFlagged, resolution: l.resolution })),
  );

  return (
    <div>
      <BackLink href="/procurement/rfq" label="采购 RFQ 比价" />
      <div className="page-head">
        <div>
          <h1 className="page-title">{prfq.code}</h1>
          <p className="page-desc">
            {prfq.sourcingMode === "SPOT" ? "现货模式" : "期货模式"} · 供应商报价{" "}
            {prfq.supplierQuotes.length} 份 · 报价行 {allLines.length} 行
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={prfq.status === "FEEDBACK_READY" ? "green" : "blue"}>
            {prfq.status === "FEEDBACK_READY" ? "已反馈 PM" : prfq.status}
          </Badge>
        </div>
      </div>

      {prfq.feedbackNote ? (
        <Banner tone="info">
          <span>
            <b>已反馈 PM</b>:{prfq.feedbackNote}
          </span>
        </Banner>
      ) : null}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">报价行</div>
          <div className="kpi-value">{progress.totalLines}</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label">原始异常行</div>
          <div className="kpi-value">{progress.flaggedLines}</div>
          <div className="kpi-foot">固化集合,阈值变化不改写</div>
        </div>
        <div className={progress.unresolved > 0 ? "kpi danger" : "kpi"}>
          <div className="kpi-label">未处理</div>
          <div className="kpi-value">{progress.unresolved}</div>
          <div className="kpi-foot">流程状态以此为准</div>
        </div>
      </div>

      <SourcingPanel
        procurementRfqId={prfq.id}
        lines={allLines}
        suppliers={suppliers}
        canSubmit={progress.canSubmitToPm}
        alreadySubmitted={prfq.status === "FEEDBACK_READY"}
      />
    </div>
  );
}
