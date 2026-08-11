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
import { formatDate } from "@/lib/format/datetime";

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
          {/*
            S-5:齐料检查并入本页后,它原有的口径说明必须一并带过来 ——
            尤其是「损耗率默认 0,口径待甲方确认」:这是 CLAUDE.md 的硬要求,
            合并时漏掉就等于把一个未确认的假设静默变成了既成事实。
          */}
          需求 = <b>ceil(单板用量 × 台数 ×(1+损耗率))</b>,缺口 = 需求 − 库存 − 在途,
          再按 MOQ / SPQ 圆整。损耗率默认 0,<b>口径待甲方确认</b>。
          库存与在途来自 ezPLM 只读缓存,在途 ETA 不代表实时;
          <b>数据缺失的行标为「数据未知」而不是按 0 当作有货</b>,并排在最前 ——
          连缺不缺都无法判定,风险高于已知缺料。
          齐料检查已并入本页(同一份计算)。
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
            {/*
              S-5:齐套率原本只在「齐料检查」页有。合并时必须把它带过来 ——
              否则"合并"就变成了"删掉一个指标",而齐套率正是判断这批能不能开工的那个数。
            */}
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
              <div className="kpi-label">数据未知行</div>
              <div className="kpi-value">{data.report.summary.unknownLines}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">预计齐料日期</div>
              <div className="kpi-value" style={{ fontSize: 18 }}>
                {formatDate(data.report.summary.readyDate, "") ||
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
                  {/*
                    S-5(客户 PR2 反馈 采购-11):
                    ①「位号不需要因为多行」→ 位号列限宽单行,完整值挂 title;
                    ②「库存和 PN」→ 补 PN、库存、在途;
                    ③「交期需要显示」→ 最早可用即交期,保留;
                    ④「不需要建议采购」→ 去掉该列。
                    齐料检查(/kitting)与本页入参、算法完全相同,已并入这里。
                  */}
                  <tr>
                    <th>PN</th>
                    <th>MPN</th>
                    <th>制造商</th>
                    <th>位号</th>
                    <th className="num">需求</th>
                    <th className="num">库存</th>
                    <th className="num">在途</th>
                    <th className="num">缺口</th>
                    <th>交期(最早可用)</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {shortages.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                        无缺料
                      </td>
                    </tr>
                  ) : (
                    shortages.map((l) => (
                      <tr key={l.lineNo} className={l.status === "unknown" ? "row-warn" : "row-danger"}>
                        <td className="small mono">{l.internalPn ?? <span className="muted">未建档</span>}</td>
                        <td className="small">
                          <MpnLink mpn={l.mpn} />
                        </td>
                        <td className="small">{l.manufacturer ?? "-"}</td>
                        {/* 位号可能很长,限宽单行 + 悬停看全,避免整行被撑高 */}
                        <td
                          className="small"
                          title={l.refDes ?? undefined}
                          style={{
                            maxWidth: 160,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {l.refDes ?? "-"}
                        </td>
                        <td className="num">{l.requiredQty}</td>
                        {/* 库存/在途未知时显示「未知」而不是 0 —— 0 会被当成"确实没有" */}
                        <td className="num">
                          {l.stockQty === null ? <span className="muted">未知</span> : l.stockQty}
                        </td>
                        <td className="num">
                          {l.inTransitQty === null ? (
                            <span className="muted">未知</span>
                          ) : (
                            l.inTransitQty
                          )}
                        </td>
                        <td className="num">
                          {l.shortageQty === null ? <span className="muted">未知</span> : l.shortageQty}
                        </td>
                        <td className="small">{formatDate(l.eta)}</td>
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
