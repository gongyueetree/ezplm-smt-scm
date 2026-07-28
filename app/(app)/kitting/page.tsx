import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { buildKittingReport } from "@/lib/server/repositories/kitting";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { MpnLink } from "@/components/ui/mpn-link";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { text: string; tone: "green" | "red" | "amber" }> = {
  ready: { text: "可齐料", tone: "green" },
  short: { text: "缺料", tone: "red" },
  unknown: { text: "数据未知", tone: "amber" },
};

export default async function KittingPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; boards?: string; scrap?: string }>;
}) {
  const { v, boards, scrap } = await searchParams;
  const session = (await getSession())!;

  const versions = await prisma.bOMVersion.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: { bom: { select: { name: true } } },
    take: 30,
  });

  const versionId = v ?? versions[0]?.id;
  const boardCount = Number(boards ?? 100);
  const scrapRate = scrap ?? "0";
  const data = versionId
    ? await buildKittingReport(session.tenantId, versionId, {
        boards: boardCount,
        scrapRate,
      })
    : null;

  return (
    <div>
      <PageHeader path="/kitting" />
      <Banner tone="soft">
        <span>
          需求 = <b>ceil(单板用量 × 台数 ×(1+损耗率))</b>,缺口 = 需求 − 库存 − 在途。
          库存与在途来自 ezPLM 只读缓存;<b>数据缺失的行标为「数据未知」而不是按 0 当作有货</b>。
          损耗率默认 0,<b>口径待甲方确认</b>。
        </span>
      </Banner>

      <Card title="选择 BOM 与投产参数">
        {versions.length === 0 ? (
          <p className="small muted">
            尚无 BOM 版本,请先在 <Link href="/bom/import">BOM 导入</Link> 导入。
          </p>
        ) : (
          <form method="get" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="fld" style={{ marginBottom: 0, minWidth: 220 }}>
              <span>BOM 版本</span>
              <select name="v" defaultValue={versionId}>
                {versions.map((ver) => (
                  <option key={ver.id} value={ver.id}>
                    {ver.bom.name} V{ver.versionNo}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ marginBottom: 0, maxWidth: 140 }}>
              <span>投产台数</span>
              <input name="boards" defaultValue={String(boardCount)} />
            </label>
            <label className="fld" style={{ marginBottom: 0, maxWidth: 180 }}>
              <span>损耗率(待甲方确认)</span>
              <input name="scrap" defaultValue={scrapRate} />
            </label>
            <button className="btn primary" type="submit">
              重新核算
            </button>
          </form>
        )}
      </Card>

      {data ? (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">齐套率</div>
              <div className="kpi-value">
                {data.report.summary.kitRate === null
                  ? "—"
                  : `${(data.report.summary.kitRate * 100).toFixed(1)}%`}
              </div>
              <div className="kpi-foot">
                {data.report.summary.readyLines}/{data.report.summary.totalLines} 行可齐料
              </div>
            </div>
            <div className="kpi danger">
              <div className="kpi-label">缺料行</div>
              <div className="kpi-value">{data.report.summary.shortLines}</div>
            </div>
            <div className="kpi warn">
              <div className="kpi-label">数据未知</div>
              <div className="kpi-value">{data.report.summary.unknownLines}</div>
              <div className="kpi-foot">不当作有货</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">预计齐料日期</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>
                {data.report.summary.readyDate
                  ? data.report.summary.readyDate.slice(0, 10)
                  : data.report.summary.shortLines === 0 && data.report.summary.unknownLines === 0
                    ? "已齐料"
                    : "未知"}
              </div>
              <div className="kpi-foot">
                {data.report.summary.readyDateBlockedBy ?? "取所有缺口行 ETA 最大值"}
              </div>
            </div>
          </div>

          <Card
            title="逐行齐料明细"
            sub={`${data.version.bom.name} V${data.version.versionNo} · ${boardCount} 台`}
            flush
          >
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>行</th>
                    <th>位号</th>
                    <th>MPN</th>
                    <th className="num">需求</th>
                    <th className="num">库存</th>
                    <th className="num">在途</th>
                    <th className="num">缺口</th>
                    <th className="num">建议采购</th>
                    <th>最早可用</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data.report.lines.map((l) => (
                    <tr
                      key={l.lineNo}
                      className={
                        l.status === "short" ? "row-danger" : l.status === "unknown" ? "row-warn" : undefined
                      }
                    >
                      <td className="num">{l.lineNo}</td>
                      <td className="small">{l.refDes ?? "-"}</td>
                      <td className="small">
                        <MpnLink mpn={l.mpn} />
                      </td>
                      <td className="num">{l.requiredQty}</td>
                      <td className="num">
                        {l.stockQty === null ? <span className="muted">未知</span> : l.stockQty}
                      </td>
                      <td className="num">
                        {l.inTransitQty === null ? <span className="muted">未知</span> : l.inTransitQty}
                      </td>
                      <td className="num">
                        {l.shortageQty === null ? <span className="muted">未知</span> : l.shortageQty}
                      </td>
                      <td className="num">
                        {l.suggestedPurchaseQty === null ? (
                          <span className="muted">—</span>
                        ) : (
                          l.suggestedPurchaseQty
                        )}
                      </td>
                      <td className="small">{l.eta?.slice(0, 10) ?? "-"}</td>
                      <td>
                        <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].text}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="下一步">
            <Link
              className="btn primary"
              href={`/shortage?v=${versionId}&boards=${boardCount}&scrap=${scrapRate}`}
            >
              查看缺料分析 / Call 料表
            </Link>
          </Card>
        </>
      ) : null}
    </div>
  );
}
