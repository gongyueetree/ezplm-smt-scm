import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { needsAlternate } from "@/lib/domain/alternate-rank";
import type { LifecycleValue } from "@/lib/providers/common/normalized-offer";
import { formatDate, formatDateTime } from "@/lib/format/datetime";
import { bomDetailMetric } from "@/lib/metrics";
import {
  alternateCounts,
  bomAuditTimeline,
  getBomDetail,
  inventoryForParts,
} from "@/lib/server/repositories/bom-detail";
import { getBomVersionDetail } from "@/lib/server/repositories/bom-import";
import { resolveErpTarget } from "@/lib/server/repositories/integration-sync";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { getSession } from "@/lib/server/session";
import { MatchReview, type ReviewLine } from "../version/[versionId]/review";
import { ManufacturingPanel } from "./manufacturing-panel";

export const dynamic = "force-dynamic";

type Tab = "lines" | "versions" | "manufacturing" | "history";

const AUDIT_ACTION_LABEL: Record<string, string> = {
  BOM_LINE_DECISION: "行级人工确认",
  BOM_BULK_CONFIRM: "批量确认高置信匹配",
  BOM_CONVERT_TO_PRODUCTION: "转为正式 BOM",
  BOM_MANUFACTURING_INFO_UPDATE: "制造工程信息更新",
};

/**
 * F7:BOM 详情页(spec docs/PAGE_SPEC_BOM_DETAIL.md)。
 *
 * - 匹配确认复用既有 MatchReview(唯一一套匹配 UI);
 * - KPI 走 lib/metrics,阈值为租户配置;
 * - T2 区块按 Feature Flag 条件渲染,关闭时**不查询**;
 * - T3 只有占位卡,无示例数据。
 */
export default async function BomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ bomId: string }>;
  searchParams: Promise<{ v?: string; tab?: string }>;
}) {
  const { bomId } = await params;
  const { v, tab: tabParam } = await searchParams;
  const session = (await getSession())!;
  const { settings } = await getTenantSettings(session.tenantId);

  const detail = await getBomDetail(session, bomId);
  if (!detail) notFound();

  const tab: Tab = (["lines", "versions", "manufacturing", "history"] as const).includes(
    tabParam as Tab,
  )
    ? (tabParam as Tab)
    : "lines";

  const currentVersion =
    detail.versions.find((x) => x.id === v) ?? detail.versions[0] ?? null;
  if (!currentVersion) notFound();

  const [kpis, versionDetail, erpTarget] = await Promise.all([
    bomDetailMetric(session.tenantId, bomId, currentVersion.id, settings.matchConfidenceThreshold),
    tab === "lines" ? getBomVersionDetail(session, currentVersion.id) : Promise.resolve(null),
    resolveErpTarget(session.tenantId),
  ]);

  // 行级库存与替代关系(仅物料明细 Tab 需要)
  let lines: ReviewLine[] = [];
  if (tab === "lines" && versionDetail) {
    const partIds = versionDetail.lines
      .map((l) => l.internalPartId)
      .filter((x): x is string => Boolean(x));
    const [invMap, altMap] = await Promise.all([
      inventoryForParts(session.tenantId, partIds),
      alternateCounts(session.tenantId, partIds),
    ]);
    lines = versionDetail.lines.map((l) => {
      const inv = l.internalPartId ? invMap.get(l.internalPartId) : undefined;
      return {
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
        inventory: l.internalPartId
          ? inv
            ? { qty: inv.qtyOnHand, fetchedAt: formatDateTime(inv.fetchedAt) }
            : null
          : undefined,
        alternateCount: l.internalPartId ? (altMap.get(l.internalPartId) ?? 0) : 0,
      };
    });
  }

  const audits = tab === "history" ? await bomAuditTimeline(session, bomId, detail.versions.map((x) => x.id)) : [];

  const tabLink = (t: Tab, label: string, testid: string) => (
    <Link
      key={t}
      className={`btn${tab === t ? " primary" : ""}`}
      href={`/bom/${bomId}?tab=${t}&v=${currentVersion.id}`}
      data-testid={testid}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <BackLink
        href={detail.bom.rfqId ? `/rfq/${detail.bom.rfqId}` : "/bom"}
        label={detail.bom.rfqId ? "所属 RFQ" : "BOM 管理"}
      />
      <div className="page-head">
        <div>
          <h1 className="page-title" data-testid="bom-detail-title">
            {detail.bom.name}
          </h1>
          <p className="page-desc">
            {detail.customer ? `客户:${detail.customer.name} · ` : ""}
            当前 V{currentVersion.versionNo} · {detail.versions.length} 个版本
            {detail.bom.rfq ? (
              <>
                {" "}
                · RFQ <Link href={`/rfq/${detail.bom.rfq.id}`}>{detail.bom.rfq.code}</Link>
              </>
            ) : null}
            {" · 关联 ECN:F2 上线后可用"}
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={detail.bom.purpose === "PRODUCTION" ? "green" : "gray"}>
            {detail.bom.purpose === "PRODUCTION" ? "正式 BOM" : "预 BOM"}
          </Badge>
          <Link className="btn" href={`/bom/version/${currentVersion.id}`}>
            版本工作页(转正式/确认)
          </Link>
        </div>
      </div>

      {/* KPI 条(lib/metrics;阈值为租户配置) */}
      <div className="kpis" data-testid="bom-kpis">
        <div className="kpi">
          <div className="kpi-num">{kpis.totalLines}</div>
          <div className="kpi-label">总物料行</div>
        </div>
        <div className="kpi">
          <div className="kpi-num">{kpis.versionCount}</div>
          <div className="kpi-label">版本数</div>
        </div>
        <div className="kpi">
          <div className="kpi-num">
            {kpis.matched}
            {kpis.matchRate !== null ? (
              <span className="small muted">({(kpis.matchRate * 100).toFixed(0)}%)</span>
            ) : null}
          </div>
          <div className="kpi-label">已匹配(人工确认)</div>
        </div>
        <div className={kpis.needsReview > 0 ? "kpi warn" : "kpi"} data-testid="kpi-needs-review">
          <div className="kpi-num">{kpis.needsReview}</div>
          <div className="kpi-label">需人工确认(&lt; {(kpis.threshold * 100).toFixed(0)}%)</div>
        </div>
        <div className={kpis.unrecognized > 0 ? "kpi danger" : "kpi"}>
          <div className="kpi-num">{kpis.unrecognized}</div>
          <div className="kpi-label">未识别</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        {tabLink("lines", "物料明细", "tab-lines")}
        {tabLink("versions", "版本", "tab-versions")}
        {settings.featureFlags["bom.manufacturingInfo"]
          ? tabLink("manufacturing", "制造工程信息", "tab-manufacturing")
          : null}
        {tabLink("history", "审批/操作历史", "tab-history")}
      </div>

      {tab === "lines" ? (
        <Card title="物料明细" sub="复用匹配确认(唯一一套);库存列为 ERP 快照缓存,标注更新时间" flush>
          <MatchReview
            lines={lines}
            versionId={currentVersion.id}
            threshold={settings.matchConfidenceThreshold}
          />
        </Card>
      ) : null}

      {tab === "versions" ? (
        <>
          <Card title="版本列表" sub="变更点数与对比复用同一 diff 函数;导出在对比页" flush>
            <table className="tbl" data-testid="version-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>创建时间</th>
                  <th>行数</th>
                  <th>已确认</th>
                  <th>变更点数(对上一版)</th>
                  <th>关联工单</th>
                  <th>说明</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {detail.versions.map((ver, idx) => (
                  <tr key={ver.id}>
                    <td>V{ver.versionNo}</td>
                    <td className="small">{formatDateTime(ver.createdAt)}</td>
                    <td className="num">{ver.lineCount}</td>
                    <td className="num">{ver.decidedCount}</td>
                    <td className="num">
                      {ver.changeCount !== null
                        ? ver.changeCount
                        : detail.diffCapped
                          ? "—(版本过多,进对比页查看)"
                          : "—(首版)"}
                    </td>
                    <td className="small muted">
                      {erpTarget.kind === "NONE"
                        ? "待接入(ERP 未配置)"
                        : "待定(BOM 与 ERP 工单的对应规则随正式 BOM 编码确认)"}
                    </td>
                    <td className="small muted">{ver.note ?? "—"}</td>
                    <td>
                      <Link className="btn xs" href={`/bom/version/${ver.id}`}>
                        打开
                      </Link>{" "}
                      {idx < detail.versions.length - 1 ? (
                        <Link
                          className="btn xs"
                          href={`/bom/compare?from=${detail.versions[idx + 1].id}&to=${ver.id}`}
                          data-testid={`compare-${ver.versionNo}`}
                        >
                          对比上一版
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {settings.featureFlags["bom.versionGraph"] ? (
            <Card
              title="版本演进图谱(T2 · Feature Flag 已开启)"
              sub="按版本序列与转换关系渲染;ECO 分支待 F2 的 ECN 回链"
            >
              <div data-testid="version-graph">
                {detail.bom.convertedFromBom ? (
                  <div className="small muted">
                    ⬑ 由预 BOM「
                    <Link href={`/bom/${detail.bom.convertedFromBom.id}`}>
                      {detail.bom.convertedFromBom.name}
                    </Link>
                    」转换而来
                  </div>
                ) : null}
                <ul style={{ margin: "8px 0 0 4px", listStyle: "none" }}>
                  {[...detail.versions]
                    .sort((a, b) => a.versionNo - b.versionNo)
                    .map((ver) => (
                      <li key={ver.id} style={{ padding: "4px 0", borderLeft: "2px solid var(--gray-200)", paddingLeft: 12 }}>
                        <Link href={`/bom/${bomId}?tab=versions&v=${ver.id}`}>V{ver.versionNo}</Link>{" "}
                        <span className="small muted">
                          {formatDate(ver.createdAt)} · {ver.lineCount} 行 · 已确认 {ver.decidedCount}
                          {ver.changeCount !== null ? ` · 变更 ${ver.changeCount}` : ""}
                        </span>
                      </li>
                    ))}
                </ul>
                {detail.bom.convertedTo.length > 0 ? (
                  <div className="small muted" style={{ marginTop: 6 }}>
                    ⬐ 已转出正式 BOM:
                    {detail.bom.convertedTo.map((t) => (
                      <Link key={t.id} href={`/bom/${t.id}`} style={{ marginLeft: 6 }}>
                        {t.name}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === "manufacturing" && settings.featureFlags["bom.manufacturingInfo"] ? (
        <ManufacturingPanel
          versionId={currentVersion.id}
          canEdit={session.roles.some((r) => r === "ENGINEERING" || r === "MANAGEMENT")}
        />
      ) : null}

      {tab === "history" ? (
        <Card title="审批/操作历史" sub="复用 AuditLog 时间线,不建流程引擎" flush>
          {audits.length === 0 ? (
            <p className="muted" style={{ padding: 16 }} data-testid="history-empty">
              暂无操作记录
            </p>
          ) : (
            <table className="tbl" data-testid="history-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>对象</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.id}>
                    <td className="small">{formatDateTime(a.createdAt)}</td>
                    <td>{AUDIT_ACTION_LABEL[a.action] ?? a.action}</td>
                    <td className="small muted">
                      {a.entityType} · {a.entityId?.slice(0, 12)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {/* T3 占位:折叠卡,无示例数据 */}
      <details style={{ marginTop: 12 }}>
        <summary className="small muted" data-testid="t3-placeholder">
          SMT 站位贴装料 / Feeder Layout · AVL 规则引擎(二期 · 待商务确认)
        </summary>
        <Banner tone="soft">
          <span>
            SMT 站位与 Feeder 排布依赖 MES/仓储扫码数据,AVL 规则引擎(5 种替代策略配置)属二期 ——
            均<b>待商务确认</b>,本页不放任何示例数据。辅料(锡膏/助焊剂等)不计入 EBOM。
          </span>
        </Banner>
      </details>
    </div>
  );
}
