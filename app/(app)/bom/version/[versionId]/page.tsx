import { notFound } from "next/navigation";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { getBomVersionDetail } from "@/lib/server/repositories/bom-import";
import { getSession } from "@/lib/server/session";
import { MatchReview, type ReviewLine } from "./review";

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
      eta: c.eta ? c.eta.toISOString().slice(0, 10) : null,
      price: c.price === null ? null : String(c.price),
      currency: c.currency,
      dataUpdatedAt: c.dataUpdatedAt ? c.dataUpdatedAt.toISOString().slice(0, 16).replace("T", " ") : null,
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
          <Badge tone={decided === lines.length ? "green" : "amber"}>
            {decided === lines.length ? "全部已确认" : "待人工确认"}
          </Badge>
        </div>
      </div>

      <Banner tone="ai">
        <span>
          候选由匹配管线自动产出(客户料号 → 内部料号 → 精确 MPN → 制造商+MPN → 描述 → ezPLM →
          DigiKey/Mouser),<b>仅为建议</b>;正式匹配必须逐行人工确认后才会写入决定。
          价格与库存显示的是各数据源的<b>数据更新时间</b>,不代表实时行情。
        </span>
      </Banner>

      <Card title="匹配确认" sub="逐行采纳候选 / 标记无匹配" flush>
        <MatchReview lines={lines} />
      </Card>
    </div>
  );
}
