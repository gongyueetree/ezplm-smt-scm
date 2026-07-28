import { notFound } from "next/navigation";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { CATEGORY_LABELS, summarizeQuote, type QuoteLineForCalc } from "@/lib/domain/quote-calc";
import {
  QUOTE_STATUS_LABELS,
  availableQuoteTransitions,
  isFrozen,
  resolveExportSource,
  type QuoteSnapshot,
  type QuoteStatusValue,
} from "@/lib/domain/quote-status";
import { getQuoteVersion } from "@/lib/server/repositories/quote";
import { getSession } from "@/lib/server/session";
import { QuoteEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function QuoteVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const session = (await getSession())!;
  const version = await getQuoteVersion(session, versionId);
  if (!version) notFound();

  const status = version.status as QuoteStatusValue;
  const calcLines: QuoteLineForCalc[] = version.lines.map((l) => ({
    lineNo: l.lineNo,
    category: l.category as QuoteLineForCalc["category"],
    qty: l.qty === null ? null : String(l.qty),
    purchaseCost: l.purchaseCost === null ? null : String(l.purchaseCost),
    markupPct: l.markupPct === null ? null : String(l.markupPct),
    customerPrice: l.customerPrice === null ? null : String(l.customerPrice),
  }));
  const live = summarizeQuote(calcLines, { currency: version.currency });

  const exportSource = resolveExportSource({
    status,
    approvedSnapshot: version.approvedSnapshot as unknown as QuoteSnapshot | null,
    submittedSnapshot: version.submittedSnapshot as unknown as QuoteSnapshot | null,
  });

  const unconfirmed = version.lines.filter((l) => !l.categoryConfirmed).map((l) => l.lineNo);
  const transitions = availableQuoteTransitions(status, session.roles);

  return (
    <div>
      <BackLink href="/quotes" label="报价管理" />
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {version.quote.code} · R{version.revision}
          </h1>
          <p className="page-desc">
            币种 {version.currency} · {version.lines.length} 行 · 未确认分类 {unconfirmed.length} 行
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={status === "APPROVED" ? "green" : status === "REJECTED" ? "red" : "amber"}>
            {QUOTE_STATUS_LABELS[status]}
          </Badge>
        </div>
      </div>

      {isFrozen(status) ? (
        <Banner tone="warn">
          <span>
            <b>参数已冻结</b>({QUOTE_STATUS_LABELS[status]}):不能修改任何报价参数;
            如需改动请<b>新建 Revision</b>,已批准版本永不被覆盖。
          </span>
        </Banner>
      ) : null}

      {version.rejectedReason ? (
        <Banner tone="warn">
          <span>
            <b>已退回</b>:{version.rejectedReason}
          </span>
        </Banner>
      ) : null}

      <div className="kpi-grid">
        {(["MATERIAL", "LABOR", "SMT", "DIP", "TEST", "OVERHEAD"] as const).map((c) => (
          <div className="kpi" key={c}>
            <div className="kpi-label">{CATEGORY_LABELS[c]}</div>
            <div className="kpi-value">{live.byCategory[c]}</div>
          </div>
        ))}
        <div className="kpi">
          <div className="kpi-label">总价({version.currency})</div>
          <div className="kpi-value">{live.grandTotal}</div>
          <div className="kpi-foot">实时试算;正式文件用快照</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">PPV 合计</div>
          <div className="kpi-value">{live.ppvTotal}</div>
          <div className="kpi-foot">仅统计给出基准的行</div>
        </div>
      </div>

      <Card title="正式导出" sub="SPEC §12:审批与正式 PDF/XLSX 必须使用快照">
        {exportSource.ok ? (
          <p className="small">
            <Badge tone="green">可导出</Badge> 数据来源:
            {exportSource.kind === "approved" ? "审批快照(approvedSnapshot)" : "提交快照(submittedSnapshot)"} ·
            冻结于 {exportSource.snapshot.frozenAt.slice(0, 16).replace("T", " ")} · 总价{" "}
            {exportSource.snapshot.summary.currency} {exportSource.snapshot.summary.grandTotal}
          </p>
        ) : (
          <p className="small muted">
            <Badge tone="gray">不可导出</Badge> {exportSource.message}
          </p>
        )}
      </Card>

      <QuoteEditor
        versionId={version.id}
        status={status}
        currency={version.currency}
        frozen={isFrozen(status)}
        transitions={transitions}
        lines={version.lines.map((l) => ({
          id: l.id,
          lineNo: l.lineNo,
          category: l.category,
          materialCategory: l.materialCategory,
          categoryConfirmed: l.categoryConfirmed,
          qty: l.qty === null ? null : String(l.qty),
          purchaseCost: l.purchaseCost === null ? null : String(l.purchaseCost),
          markupPct: l.markupPct === null ? null : String(l.markupPct),
        }))}
        summaryLines={live.lines}
      />
    </div>
  );
}
