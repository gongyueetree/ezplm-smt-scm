import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { compareBomVersions } from "@/lib/domain/bom-compare";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, { text: string; tone: "green" | "amber" | "red" | "gray" }> = {
  added: { text: "新增", tone: "green" },
  removed: { text: "删除", tone: "red" },
  qty_changed: { text: "数量变更", tone: "amber" },
  part_changed: { text: "料号变更", tone: "amber" },
  unchanged: { text: "未变化", tone: "gray" },
};

async function loadLines(tenantId: string, versionId: string): Promise<ParsedBomLine[]> {
  const rows = await prisma.bOMLine.findMany({
    where: tenantWhere(tenantId, { bomVersionId: versionId }),
    orderBy: { lineNo: "asc" },
  });
  return rows.map((l) => ({
    sourceRow: l.lineNo,
    lineNo: l.lineNo,
    refDes: l.refDes,
    qty: Number(l.qty),
    mpn: l.mpn,
    manufacturer: l.manufacturer,
    customerPn: l.customerPn,
    internalPn: null,
    description: l.description,
    footprint: l.footprint,
    issues: [],
  }));
}

export default async function BomComparePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const session = (await getSession())!;

  const versions = await prisma.bOMVersion.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: { bom: { select: { name: true } } },
    take: 50,
  });

  if (!from || !to) {
    return (
      <div>
        <PageHeader path="/bom/compare" />
        <Banner tone="soft">
          从 <Link href="/bom">BOM 台账</Link> 选择同一 BOM 的两个版本进入比对,或用
          <span className="mono"> ?from=版本ID&to=版本ID </span>访问本页。
        </Banner>
        <Card title="可选版本" sub={`${versions.length} 个`} flush>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>BOM</th>
                  <th className="num">版本</th>
                  <th>版本 ID</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>{v.bom.name}</td>
                    <td className="num">V{v.versionNo}</td>
                    <td className="mono small">{v.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  const [beforeLines, afterLines] = await Promise.all([
    loadLines(session.tenantId, from),
    loadLines(session.tenantId, to),
  ]);
  const { entries, summary } = compareBomVersions(beforeLines, afterLines);
  const changed = entries.filter((e) => e.type !== "unchanged");

  return (
    <div>
      <PageHeader path="/bom/compare" />
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">新增</div>
          <div className="kpi-value">{summary.added}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">删除</div>
          <div className="kpi-value">{summary.removed}</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label">数量变更</div>
          <div className="kpi-value">{summary.qtyChanged}</div>
        </div>
        <div className="kpi warn">
          <div className="kpi-label">料号变更</div>
          <div className="kpi-value">{summary.partChanged}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">未变化</div>
          <div className="kpi-value">{summary.unchanged}</div>
        </div>
      </div>

      <Card title="差异明细" sub={`${changed.length} 处变化(以位号集合为主键,行序变化不算差异)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>类型</th>
                <th>主键</th>
                <th>变更前</th>
                <th>变更后</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {changed.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    两个版本无差异
                  </td>
                </tr>
              ) : (
                changed.map((e) => (
                  <tr key={e.key}>
                    <td>
                      <Badge tone={TYPE_LABEL[e.type].tone}>{TYPE_LABEL[e.type].text}</Badge>
                    </td>
                    <td className="mono small">{e.key}</td>
                    <td className="small">
                      {e.before ? `${e.before.mpn ?? "-"} ×${e.before.qty ?? "-"}` : "—"}
                    </td>
                    <td className="small">
                      {e.after ? `${e.after.mpn ?? "-"} ×${e.after.qty ?? "-"}` : "—"}
                    </td>
                    <td className="small muted">{e.changes.join(";")}</td>
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
