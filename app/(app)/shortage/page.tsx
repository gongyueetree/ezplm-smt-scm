import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { deriveShortageList } from "@/lib/domain/kitting";
import { buildKittingReport } from "@/lib/server/repositories/kitting";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { MpnLink } from "@/components/ui/mpn-link";

export const dynamic = "force-dynamic";

export default async function ShortagePage({
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
    ? await buildKittingReport(session.tenantId, versionId, { boards: boardCount, scrapRate })
    : null;
  const shortages = data ? deriveShortageList(data.report) : [];

  return (
    <div>
      <PageHeader path="/shortage" />
      <Banner tone="soft">
        <span>
          缺料清单由齐料核算派生(与<Link href="/kitting">齐料检查</Link>同一份计算)。
          <b>「数据未知」行排在最前</b> —— 连缺不缺都无法判定,风险高于已知缺料。
          在途 ETA 来自 ezPLM/OPO 缓存,不代表实时。
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
              重新分析
            </button>
          </form>
        )}
      </Card>

      {data ? (
        <>
          <div className="kpi-grid">
            <div className="kpi danger">
              <div className="kpi-label">缺料行</div>
              <div className="kpi-value">{data.report.summary.shortLines}</div>
            </div>
            <div className="kpi warn">
              <div className="kpi-label">数据未知行</div>
              <div className="kpi-value">{data.report.summary.unknownLines}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">预计齐料日期</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>
                {data.report.summary.readyDate?.slice(0, 10) ??
                  (shortages.length === 0 ? "已齐料" : "未知")}
              </div>
              <div className="kpi-foot">{data.report.summary.readyDateBlockedBy ?? ""}</div>
            </div>
          </div>

          <Card
            title="Call 料表"
            sub={`${shortages.length} 行需跟进`}
            flush
          >
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>MPN</th>
                    <th>制造商</th>
                    <th>位号</th>
                    <th className="num">需求</th>
                    <th className="num">缺口</th>
                    <th className="num">建议采购</th>
                    <th>最早可用</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {shortages.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                        无缺料
                      </td>
                    </tr>
                  ) : (
                    shortages.map((l) => (
                      <tr key={l.lineNo} className={l.status === "unknown" ? "row-warn" : "row-danger"}>
                        <td className="small">
                          <MpnLink mpn={l.mpn} />
                        </td>
                        <td className="small">{l.manufacturer ?? "-"}</td>
                        <td className="small">{l.refDes ?? "-"}</td>
                        <td className="num">{l.requiredQty}</td>
                        <td className="num">
                          {l.shortageQty === null ? <span className="muted">未知</span> : l.shortageQty}
                        </td>
                        <td className="num">
                          {l.suggestedPurchaseQty === null ? "—" : l.suggestedPurchaseQty}
                        </td>
                        <td className="small">{l.eta?.slice(0, 10) ?? "-"}</td>
                        <td>
                          <Badge tone={l.status === "unknown" ? "amber" : "red"}>
                            {l.status === "unknown" ? "数据未知" : "缺料"}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="导出">
            <a
              className="btn"
              href={`/api/shortage/export?v=${versionId}&boards=${boardCount}&scrap=${scrapRate}`}
            >
              导出 Call 料表(XLSX)
            </a>
          </Card>
        </>
      ) : null}
    </div>
  );
}
