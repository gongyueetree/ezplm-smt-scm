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
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { getSession } from "@/lib/server/session";
import { QuoteEditor } from "./editor";
import { CollabPanel } from "./collab-panel";
import type { QuoteOutcomeValue } from "@/lib/domain/quote-outcome";
import { formatDate } from "@/lib/format/datetime";
import Decimal from "decimal.js";

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

  const bomVersions = await prisma.bOMVersion.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: { bom: { select: { name: true } } },
    take: 20,
  });
  const unconfirmed = version.lines.filter((l) => !l.categoryConfirmed).map((l) => l.lineNo);

  // PR-D:分项派工 / NRE 字典 / 订单结果
  const [tasks, nreDefs, quote, approvedCount] = await Promise.all([
    prisma.quoteComponentTask.findMany({
      where: tenantWhere(session.tenantId, { quoteVersionId: versionId }),
      orderBy: { createdAt: "asc" },
    }),
    prisma.nreItemDefinition.findMany({
      where: tenantWhere(session.tenantId, { active: true }),
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    prisma.quote.findFirst({
      where: tenantWhere(session.tenantId, { id: version.quoteId }),
      select: { outcome: true, customerOrderNo: true, outcomeNote: true },
    }),
    prisma.quoteVersion.count({
      where: tenantWhere(session.tenantId, { quoteId: version.quoteId, status: "APPROVED" as const }),
    }),
  ]);
  const transitions = availableQuoteTransitions(status, session.roles);

  /*
   * 人工合计 = LABOR + SMT + DIP + TEST。
   * 用 Decimal 相加 —— 金额一律不走浮点(CLAUDE.md:价格由确定性函数计算)。
   */
  const LABOR_PARTS = ["LABOR", "SMT", "DIP", "TEST"] as const;
  const laborTotal = LABOR_PARTS.reduce(
    (sum, c) => sum.plus(new Decimal(live.byCategory[c] ?? "0")),
    new Decimal(0),
  ).toFixed(2);

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

      {/*
        S-1(客户 PR2 反馈 PM-7:「无需在抬头显示 DIP 或 SMT,在下拉菜单中显示即可」)。
        SMT / DIP / 测试都是**人工的细分**,占着抬头位置反而把「材料 / 人工 / 管理费」
        这三个真正要看的数字挤没了。抬头只留三项,细分挂在人工下面显示 ——
        **不是把它们藏起来**:金额照旧参与合计,行明细里也仍按各自分类标注。
      */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">{CATEGORY_LABELS.MATERIAL}</div>
          <div className="kpi-value">{live.byCategory.MATERIAL}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">人工合计</div>
          <div className="kpi-value">{laborTotal}</div>
          <div className="kpi-foot">
            {LABOR_PARTS.map((c) => `${CATEGORY_LABELS[c]} ${live.byCategory[c]}`).join(" · ")}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{CATEGORY_LABELS.OVERHEAD}</div>
          <div className="kpi-value">{live.byCategory.OVERHEAD}</div>
        </div>
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
        {/*
          S-2(客户 PR2 反馈 PM-8:「最后生成报价单不知在哪里生成」)。
          这张卡片叫「正式导出」却只有文字,真正的按钮埋在页面最下方的
          「状态与流转」按钮堆里 —— 找不到是必然的。把入口放回它该在的地方。
        */}
        {exportSource.ok ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <a className="btn primary" href={`/api/quotes/${version.id}/export`}>
              导出 XLSX(取快照)
            </a>
            <a
              className="btn"
              href={`/quotes/${version.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              打印视图 / 另存为 PDF
            </a>
          </div>
        ) : null}
      </Card>

      <Card
        title="报价协作"
        sub="分项派工(PM)· NRE 填报(工程,直接回报价)· 订单结果(人工标记)"
      >
        <CollabPanel
          versionId={version.id}
          frozen={isFrozen(status)}
          canAssign={session.roles.some((r) => r === "PM" || r === "MANAGEMENT")}
          canMarkOutcome={session.roles.some((r) => r === "PM" || r === "MANAGEMENT")}
          tasks={tasks.map((t) => ({
            id: t.id,
            kind: t.kind,
            title: t.title,
            assignedRole: t.assignedRole,
            required: t.required,
            status: t.status,
            note: t.note,
          }))}
          nreDefs={nreDefs.map((d) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            // 字典没维护默认金额就传 null —— 填报处留空,不显示 0
            defaultAmount: d.defaultAmount === null ? null : String(d.defaultAmount),
          }))}
          outcome={(quote?.outcome ?? "OPEN") as QuoteOutcomeValue}
          customerOrderNo={quote?.customerOrderNo ?? null}
          outcomeNote={quote?.outcomeNote ?? null}
          hasApprovedVersion={approvedCount > 0}
        />
      </Card>

      <QuoteEditor
        versionId={version.id}
        status={status}
        currency={version.currency}
        validUntil={version.validUntil ? formatDate(version.validUntil) : null}
        frozen={isFrozen(status)}
        transitions={transitions}
        lines={version.lines.map((l) => ({
          id: l.id,
          lineNo: l.lineNo,
          quotedMpn: l.quotedMpn,
          quotedMfg: l.quotedMfg,
          altMfg: l.altMfg,
          altMpn: l.altMpn,
          category: l.category,
          materialCategory: l.materialCategory,
          categoryConfirmed: l.categoryConfirmed,
          qty: l.qty === null ? null : String(l.qty),
          purchaseCost: l.purchaseCost === null ? null : String(l.purchaseCost),
          markupPct: l.markupPct === null ? null : String(l.markupPct),
        }))}
        summaryLines={live.lines}
        bomVersions={bomVersions.map((b) => ({ id: b.id, label: `${b.bom.name} V${b.versionNo}` }))}
      />
    </div>
  );
}
