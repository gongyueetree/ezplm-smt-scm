import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { MpnLink } from "@/components/ui/mpn-link";
import { PageHeader } from "@/components/ui/page-header";
import {
  COMPLIANCE_DOC_KINDS,
  DOC_EXPIRY_BUCKETS,
  expiryBucket,
  expiryTone,
  summarizeCompliance,
  type DocRef,
} from "@/lib/domain/doc-expiry";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { formatDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  ROHS_REPORT: "RoHS 报告",
  REACH_REPORT: "REACH 报告",
  COC: "COC",
  APPROVAL_SHEET: "承认书",
  DATASHEET: "规格书",
  OTHER: "其它",
};

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const focus = DOC_EXPIRY_BUCKETS.includes(sp.bucket as (typeof DOC_EXPIRY_BUCKETS)[number])
    ? (sp.bucket as (typeof DOC_EXPIRY_BUCKETS)[number])
    : null;

  const [docs, parts] = await Promise.all([
    prisma.partDocument.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, partId: true, kind: true, validUntil: true, fileName: true, version: true },
      take: 5000,
    }),
    prisma.part.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, internalPn: true, mpn: true },
      take: 5000,
    }),
  ]);

  const partById = new Map(parts.map((p) => [p.id, p]));
  const asOf = new Date().toISOString();
  const refs: DocRef[] = docs.map((d) => ({
    partId: d.partId,
    internalPn: partById.get(d.partId)?.internalPn ?? "",
    kind: d.kind,
    validUntil: d.validUntil?.toISOString() ?? null,
  }));
  const summary = summarizeCompliance(refs, parts.map((p) => p.id), asOf);

  const rows = docs
    .map((d) => ({
      ...d,
      part: partById.get(d.partId),
      bucket: expiryBucket(d.validUntil?.toISOString() ?? null, asOf),
    }))
    .filter((r) => (COMPLIANCE_DOC_KINDS as readonly string[]).includes(r.kind))
    .filter((r) => (focus ? r.bucket === focus : true))
    .sort((a, b) => {
      // 过期的排最前;未标注的排在"有效"之前 —— 未知不是好消息
      const order = DOC_EXPIRY_BUCKETS.indexOf(a.bucket) - DOC_EXPIRY_BUCKETS.indexOf(b.bucket);
      if (order !== 0) return order;
      return (a.part?.internalPn ?? "").localeCompare(b.part?.internalPn ?? "");
    })
    .slice(0, 300);

  return (
    <div>
      <PageHeader path="/materials/compliance" />

      <Banner tone="soft">
        <span>
          管控 RoHS 报告 / REACH 报告 / COC 三类合规文档的有效期。
          <b>「未标注有效期」按告警处理,不按正常</b> —— 状态不可知不等于合规;
          <b>「缺少该类文档」与「文档已过期」是两件事</b>,分开统计,不混为一谈。
          数据截至 {asOf.slice(0, 10)}。
        </span>
      </Banner>

      <div className="kpi-grid">
        <Link className={summary.urgentCount > 0 ? "kpi danger" : "kpi"} href="/materials/compliance?bucket=已过期">
          <div className="kpi-label">需立刻处理</div>
          <div className="kpi-value">{summary.urgentCount}</div>
          <div className="kpi-foot">已过期 + 30 天内到期</div>
        </Link>
        {summary.buckets
          .filter((b) => b.bucket !== "有效")
          .map((b) => (
            <Link
              key={b.bucket}
              className={
                b.count > 0 && (b.bucket === "已过期" || b.bucket === "未标注有效期")
                  ? "kpi warn"
                  : "kpi"
              }
              href={`/materials/compliance?bucket=${encodeURIComponent(b.bucket)}`}
            >
              <div className="kpi-label">{b.bucket}</div>
              <div className="kpi-value">{b.count}</div>
              <div className="kpi-foot">份文档</div>
            </Link>
          ))}
      </div>

      <Card title="缺少合规文档的物料" sub="与「文档过期」是两件事:这些料**一份都没有**" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>文档类型</th>
                <th className="num">缺少该类文档的物料数</th>
                <th className="num">物料总数</th>
              </tr>
            </thead>
            <tbody>
              {summary.missingByKind.map((m) => (
                <tr key={m.kind}>
                  <td>{KIND_LABEL[m.kind] ?? m.kind}</td>
                  <td className="num">
                    <b style={{ color: m.missingParts > 0 ? "var(--danger)" : undefined }}>
                      {m.missingParts}
                    </b>
                  </td>
                  <td className="num muted">{parts.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="合规文档清单"
        sub={focus ? `已筛选:${focus} · ${rows.length} 份` : `${rows.length} 份(最多 300)`}
        flush
      >
        <div style={{ padding: "8px 16px 0" }}>
          {focus ? (
            <Link className="btn xs" href="/materials/compliance">
              清除筛选
            </Link>
          ) : null}
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>内部料号</th>
                <th>MPN</th>
                <th>类型</th>
                <th>文件</th>
                <th>版本</th>
                <th>有效期至</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    {focus ? "该档位下暂无文档" : "尚未上传任何合规文档"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono small">
                      <Link href={`/materials/${encodeURIComponent(r.part?.mpn ?? r.part?.internalPn ?? "")}`}>
                        {r.part?.internalPn ?? "-"}
                      </Link>
                    </td>
                    <td className="small">{r.part?.mpn ? <MpnLink mpn={r.part.mpn} /> : "-"}</td>
                    <td className="small">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="small muted">{r.fileName ?? "-"}</td>
                    <td className="small muted">{r.version ?? "-"}</td>
                    <td className="small">
                      {r.validUntil ? (
                        formatDate(r.validUntil)
                      ) : (
                        <span className="muted">未标注</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={expiryTone(r.bucket)}>{r.bucket}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
