import { notFound } from "next/navigation";
import { BackLink } from "@/components/shell/back-link";
import { VersionActions } from "./version-actions";
import { ConvertPanel } from "./convert-panel";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { getBomVersionDetail } from "@/lib/server/repositories/bom-import";
import { getSession } from "@/lib/server/session";
import { MatchReview, type ReviewLine } from "./review";
import { needsAlternate } from "@/lib/domain/alternate-rank";
import type { LifecycleValue } from "@/lib/providers/common/normalized-offer";
import { formatDate, formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function BomVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const session = (await getSession())!;
  const detail = await getBomVersionDetail(session, versionId);
  if (!detail) notFound();

  // PR-C:转正式 BOM 需要选客户(客户 Q4:「正式 BOM 必须关联客户编码」)
  const customers = await prisma.customer.findMany({
    where: tenantWhere(session.tenantId),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const lines: ReviewLine[] = detail.lines.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    refDes: l.refDes,
    qty: Number(l.qty),
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    description: l.description,
    footprint: l.footprint,
    packageCode: l.packageCode,
    mpnSource: l.mpnSource,
    // 需不需要找替代料:没候选,或最佳候选已停产/NRND
    alternateHint: needsAlternate({
      matched: l.matchCandidates.length > 0,
      lifecycle: (l.matchCandidates[0]?.lifecycle ?? null) as LifecycleValue | null,
    }).reason,
    flags: {
      dupRefDes: l.dupRefDesFlag,
      eol: l.eolFlag,
      footprintMismatch: l.footprintMismatch,
    },
    decision: l.decisions[0]
      ? { decision: l.decisions[0].decision, candidateId: l.decisions[0].candidateId }
      : null,
    candidates: l.matchCandidates.map((c) => ({
      id: c.id,
      source: c.source,
      confidence: Number(c.confidence),
      mpn: c.mpn,
      matchReason: c.matchReason,
      manufacturer: c.manufacturer,
      footprint: c.footprint,
      lifecycle: c.lifecycle,
      stockQty: c.stockQty === null ? null : Number(c.stockQty),
      slowMovingQty: c.slowMovingQty === null ? null : Number(c.slowMovingQty),
      opoQty: c.opoQty === null ? null : Number(c.opoQty),
      eta: c.eta ? formatDate(c.eta) : null,
      price: c.price === null ? null : String(c.price),
      currency: c.currency,
      dataUpdatedAt: c.dataUpdatedAt ? formatDateTime(c.dataUpdatedAt) : null,
    })),
  }));

  const decided = lines.filter((l) => l.decision).length;

  return (
    <div>
      <BackLink href="/bom" label="BOM 管理" />
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {detail.version.bom.name} · V{detail.version.versionNo}
          </h1>
          <p className="page-desc">
            {lines.length} 行 · 已人工确认 {decided} 行 · 未确认 {lines.length - decided} 行
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={detail.version.bom.purpose === "PRODUCTION" ? "green" : "gray"}>
            {detail.version.bom.purpose === "PRODUCTION" ? "正式 BOM" : "预 BOM"}
          </Badge>
          <Badge tone={decided === lines.length ? "green" : "amber"}>
            {decided === lines.length ? "全部已确认" : "待人工确认"}
          </Badge>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <VersionActions versionId={detail.version.id} allConfirmed={decided === lines.length} />
      </div>

      <Banner tone="ai">
        <span>
          候选由匹配管线自动产出(客户料号 → 内部料号 → 精确 MPN → 制造商+MPN → 描述 → ezPLM →
          DigiKey/Mouser),<b>仅为建议</b>;正式匹配必须逐行人工确认后才会写入决定。
          价格与库存显示的是各数据源的<b>数据更新时间</b>,不代表实时行情。
        </span>
      </Banner>

      <Card
        title={detail.version.bom.purpose === "PRODUCTION" ? "正式 BOM" : "转为正式 BOM"}
        sub="预 BOM 用于报价,正式 BOM 用于量产 —— 转换生成新文件,不改原件"
      >
        <ConvertPanel
          bomId={detail.version.bom.id}
          purpose={detail.version.bom.purpose}
          customerId={detail.version.bom.customerId}
          customers={customers}
          convertedFromBomId={detail.version.bom.convertedFromBomId}
        />
      </Card>

      <Card title="匹配确认" sub="逐行采纳候选 / 标记无匹配" flush>
        <MatchReview lines={lines} />
      </Card>
    </div>
  );
}
