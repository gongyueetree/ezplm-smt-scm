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
import { MpnLink } from "@/components/ui/mpn-link";
import { SaveCompareRun } from "./save-run";
import { VersionPicker } from "./version-picker";
import { formatDateTime } from "@/lib/format/datetime";

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

  /*
   * D-3:版本列表原来固定 take: 50 且**触顶时无人知晓** —— 版本超过 50 个,
   * 旧版本就再也选不到,而页面看不出少了东西。多取一条判断是否触顶,
   * 触顶就如实说,别让人以为"这个版本不存在"。
   */
  const VERSION_CAP = 50;
  const versionRows = await prisma.bOMVersion.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: { bom: { select: { name: true } } },
    take: VERSION_CAP + 1,
  });
  const versionsTruncated = versionRows.length > VERSION_CAP;
  const versions = versionsTruncated ? versionRows.slice(0, VERSION_CAP) : versionRows;
  const versionTruncatedNotice = versionsTruncated
    ? `版本数超过 ${VERSION_CAP} 个,这里只列出最近 ${VERSION_CAP} 个。更早的版本请从 BOM 台账进入比对。`
    : null;
  const versionOptions = versions.map((v) => ({
    id: v.id,
    label: `${v.bom.name} V${v.versionNo}(${formatDateTime(v.createdAt)})`,
  }));

  const runs = await prisma.bomCompareRun.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const Ledger = () => (
    <Card
      title="历史比对台账"
      sub={`${runs.length} 条 · 点「重新打开」直接回到同一对版本,不用再选`}
      flush
    >
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>比对</th>
              <th className="num">新增</th>
              <th className="num">删除</th>
              <th className="num">数量变更</th>
              <th className="num">料号变更</th>
              <th>比对时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                  台账为空 —— 选定两个版本比对后,点上方的保存按钮即可留存快照
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.label}</td>
                  <td className="num">{r.addedCount}</td>
                  <td className="num">{r.removedCount}</td>
                  <td className="num">{r.qtyChangedCount}</td>
                  <td className="num">{r.partChangedCount}</td>
                  <td className="small muted">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td>
                    <Link
                      className="btn xs"
                      href={`/bom/compare?from=${r.fromVersionId}&to=${r.toVersionId}`}
                    >
                      重新打开
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );

  if (!from || !to) {
    return (
      <div>
        <PageHeader path="/bom/compare" />
        <Banner tone="soft">
          {to ? (
            <span>
              已把刚导入的版本选为<b>变更后</b>,请在下表挑一个<b>变更前</b>版本。
            </span>
          ) : from ? (
            <span>
              已选定<b>变更前</b>版本,请在下表挑一个<b>变更后</b>版本。
            </span>
          ) : (
            <span>
              选择两个版本进入比对(可跨 BOM);也可从 <Link href="/bom">BOM 台账</Link> 或
              导入完成页直接进入。
            </span>
          )}
        </Banner>
        <VersionPicker
          versions={versionOptions}
          from={from}
          to={to}
          truncatedNotice={versionTruncatedNotice}
        />
        <Ledger />
        <Card title="可选版本" sub={`${versions.length} 个 · 也可直接在上方下拉里选`} flush>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>BOM</th>
                  <th className="num">版本</th>
                  <th>版本 ID</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>{v.bom.name}</td>
                    <td className="num">V{v.versionNo}</td>
                    <td className="mono small">{v.id}</td>
                    <td>
                      {to && v.id !== to ? (
                        <Link className="btn xs" href={`/bom/compare?from=${v.id}&to=${to}`}>
                          选为变更前
                        </Link>
                      ) : from && v.id !== from ? (
                        <Link className="btn xs" href={`/bom/compare?from=${from}&to=${v.id}`}>
                          选为变更后
                        </Link>
                      ) : (
                        <span className="muted small">已选定</span>
                      )}
                    </td>
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
      <Card title="本次比对" sub="比对结果可存入台账留档">
        <SaveCompareRun from={from} to={to} />
        {/* F7:差异导出 —— 与本页共用 compareBomVersions,无第二套 diff */}
        <a className="btn" href={`/api/bom/compare/export?from=${from}&to=${to}`} data-testid="compare-export">
          导出差异 CSV
        </a>
      </Card>
      {/* 看完一对之后往往要换一对 —— 不该逼人退回去重新走一遍 */}
      <VersionPicker
        versions={versionOptions}
        from={from}
        to={to}
        truncatedNotice={versionTruncatedNotice}
      />
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
                      {e.before ? (
                        <>
                          <MpnLink mpn={e.before.mpn} /> ×{e.before.qty ?? "-"}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="small">
                      {e.after ? (
                        <>
                          <MpnLink mpn={e.after.mpn} /> ×{e.after.qty ?? "-"}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="small muted">{e.changes.join(";")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Ledger />
    </div>
  );
}
