import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  buildPeriodTrend,
  groupScrapWithAmount,
  recentPeriods,
  type StandardCostLookup,
  summarizeScrap,
  UNKNOWN_KEY,
  type ScrapDimension,
  type ScrapRow,
} from "@/lib/domain/scrap-report";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { ScrapImport } from "./import-form";
import { formatDate } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

const DIMENSIONS: { key: ScrapDimension; label: string }[] = [
  { key: "mpn", label: "按物料" },
  { key: "customerId", label: "按客户" },
  { key: "reason", label: "按原因" },
  { key: "period", label: "按期间" },
];

export default async function ScrapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const dim: ScrapDimension =
    DIMENSIONS.find((d) => d.key === sp.dim)?.key ?? "mpn";

  const where: Record<string, unknown> = {};
  if (sp.period) where.period = sp.period;
  if (sp.customerId) where.customerId = sp.customerId;
  if (sp.mpn) where.mpn = { contains: sp.mpn, mode: "insensitive" as const };

  const [records, periods, customers] = await Promise.all([
    prisma.scrapRecord.findMany({
      where: tenantWhere(session.tenantId, where),
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.scrapRecord.findMany({
      where: tenantWhere(session.tenantId),
      select: { period: true },
      distinct: ["period"],
      orderBy: { period: "desc" },
    }),
    prisma.customer.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows: ScrapRow[] = records.map((r) => ({
    period: r.period,
    customerId: r.customerId,
    workOrder: r.workOrder,
    mpn: r.mpn,
    issuedQty: r.issuedQty.toString(),
    scrapQty: r.scrapQty.toString(),
    reason: r.reason,
  }));

  const summary = summarizeScrap(rows);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  /*
   * N-12:标准价(STD)从物料主数据取。**没维护的料不计入金额**,
   * 由 groupScrapWithAmount 单列出来 —— 按 0 算会让损耗金额凭空变小,
   * 而损耗最严重的料往往正是没人维护主数据的那些。
   */
  const scrapMpns = [...new Set(rows.map((r) => r.mpn).filter((m): m is string => !!m))];
  const costParts = scrapMpns.length
    ? await prisma.part.findMany({
        where: tenantWhere(session.tenantId, {
          mpn: { in: scrapMpns },
          standardCost: { not: null },
        }),
        select: { mpn: true, standardCost: true, standardCostCurrency: true },
      })
    : [];
  const costByMpn = new Map(
    costParts.map((p) => [
      p.mpn ?? "",
      { unitCost: p.standardCost!.toString(), currency: p.standardCostCurrency ?? "CNY" },
    ]),
  );
  const lookupCost: StandardCostLookup = (mpn) => (mpn ? costByMpn.get(mpn) ?? null : null);

  const groups = groupScrapWithAmount(rows, dim, lookupCost);

  /*
   * 多月比较:期间列由 recentPeriods 生成而不是从数据里推 ——
   * 数据里没有的月份也要出现在表里。那个月为空本身就是信息:
   * 是真的零损耗,还是那个月忘了导数据?两者绝不能长得一样。
   */
  const trendDim = dim === "period" ? "mpn" : dim;
  /*
   * 取**最近的合法 YYYY-MM 期间**作为趋势表的终点。
   *
   * 不能直接用 periods[0] —— 期间标签是自由文本,库里可能存在
   * 「2026年7月」「Q3」这类值,字典序排序后它们会排到真实月份前面,
   * 于是 recentPeriods 拿到一个解析不了的值,趋势表塌成一列而没人察觉。
   * (实测:E2E 遗留的 "E2E-93912" 就把表压成了 1 列。)
   */
  const latestPeriod =
    periods.map((p) => p.period).find((p) => /^\d{4}-\d{2}$/.test(p.trim())) ??
    // 兜底期间也要按部署时区取 —— 用 UTC 会在每月 1 号的早八小时里给出上个月
    formatDate(new Date()).slice(0, 7);
  const trendPeriods = recentPeriods(latestPeriod, 6);
  // 趋势表用**不带期间筛选**的数据,否则选了单月就没有"多月"可比
  const trendRecords = await prisma.scrapRecord.findMany({
    where: tenantWhere(session.tenantId, {
      period: { in: trendPeriods },
      ...(sp.customerId ? { customerId: sp.customerId } : {}),
    }),
    take: 20000,
  });
  const trendRows: ScrapRow[] = trendRecords.map((r) => ({
    period: r.period,
    customerId: r.customerId,
    workOrder: r.workOrder,
    mpn: r.mpn,
    issuedQty: r.issuedQty.toString(),
    scrapQty: r.scrapQty.toString(),
    reason: r.reason,
  }));
  const trend = buildPeriodTrend(trendRows, trendDim, trendPeriods, lookupCost).slice(0, 20);

  const q = new URLSearchParams();
  for (const k of ["period", "customerId", "mpn"]) if (sp[k]) q.set(k, sp[k]!);

  return (
    <div>
      <PageHeader path="/scrap" />

      <Banner tone="soft">
        <span>
          <b>本系统没有工单投料数据</b> —— 真实投料/报废在 MES/ERP。
          这里的数据来源是<b>人工导入</b>,一期提供导入、按条件分析与按模板导出。
          损耗率 = 报废 ÷ 发料;<b>发料为 0 时损耗率标为「不可算」而不是 0%</b> ——
          否则最该查的那条会看起来最健康。当前有 <b>{summary.zeroIssuedWithScrap}</b> 行属于这种情况。
        </span>
      </Banner>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">合计发料</div>
          <div className="kpi-value">{summary.totalIssued}</div>
        </div>
        <div className={Number(summary.totalScrap) > 0 ? "kpi warn" : "kpi"}>
          <div className="kpi-label">合计报废</div>
          <div className="kpi-value">{summary.totalScrap}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">整体损耗率</div>
          <div className="kpi-value">
            {summary.overallRate === null
              ? "不可算"
              : `${(Number(summary.overallRate) * 100).toFixed(2)}%`}
          </div>
          <div className="kpi-foot">
            {summary.overallRate === null ? "合计发料为 0" : `${summary.rowCount} 条记录`}
          </div>
        </div>
        <div className={summary.zeroIssuedWithScrap > 0 ? "kpi danger" : "kpi"}>
          <div className="kpi-label">发料 0 却有报废</div>
          <div className="kpi-value">{summary.zeroIssuedWithScrap}</div>
          <div className="kpi-foot">损耗率不可算,单独列出</div>
        </div>
      </div>

      <Card title="筛选与导出" sub="期间 / 客户 / 物料;导出可按客户模板">
        <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>期间</span>
            <select name="period" defaultValue={sp.period ?? ""}>
              <option value="">全部</option>
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {p.period}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>客户</span>
            <select name="customerId" defaultValue={sp.customerId ?? ""}>
              <option value="">全部</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>物料(MPN 含)</span>
            <input name="mpn" defaultValue={sp.mpn ?? ""} placeholder="如 STM32" />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>汇总维度</span>
            <select name="dim" defaultValue={dim}>
              {DIMENSIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            分析
          </button>
          <a className="btn" href="/scrap">
            重置
          </a>
          <a className="btn" href={`/api/scrap/export?${q.toString()}`}>
            导出损耗报告
          </a>
        </form>
      </Card>

      <ScrapImport />

      <Card
        title={`损耗分析(${DIMENSIONS.find((d) => d.key === dim)?.label})`}
        sub={`${groups.length} 组 · 按报废量排序,未填项固定排末尾`}
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>{DIMENSIONS.find((d) => d.key === dim)?.label.replace("按", "")}</th>
                <th className="num">发料</th>
                <th className="num">报废</th>
                <th className="num">损耗率</th>
                {/* N-12②③:按金额分析,单价取物料主数据的标准价(STD) */}
                <th className="num">损耗金额</th>
                <th className="num">记录数</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无损耗数据 —— 可在上方导入
                  </td>
                </tr>
              ) : (
                groups.map((g) => (
                  <tr key={g.key}>
                    <td className="small">
                      {g.isUnknown ? (
                        <Badge tone="gray">未填</Badge>
                      ) : dim === "customerId" ? (
                        (customerName.get(g.key) ?? g.key)
                      ) : (
                        g.key
                      )}
                    </td>
                    <td className="num">{g.issuedQty}</td>
                    <td className="num">{g.scrapQty}</td>
                    <td className="num">
                      {g.scrapRate === null ? (
                        <span className="muted">不可算</span>
                      ) : (
                        `${(Number(g.scrapRate) * 100).toFixed(2)}%`
                      )}
                    </td>
                    <td className="num">
                      {/*
                        缺标准价时显示「未维护」而**不是 0** —— 按 0 算会让损耗金额
                        凭空变小,而损耗最重的料往往正是没人维护主数据的那些。
                      */}
                      {g.scrapAmount === null ? (
                        <span className="muted" title={g.mixedCurrency ? "组内混多种币种,系统无汇率源,不做换算合计" : "该组物料未维护标准价"}>
                          {g.mixedCurrency ? "多币种" : "未维护"}
                        </span>
                      ) : (
                        `${g.currency ?? ""} ${g.scrapAmount}`
                      )}
                      {g.rowsWithoutCost > 0 && g.scrapAmount !== null ? (
                        <div className="small muted">{g.rowsWithoutCost} 行缺价未计入</div>
                      ) : null}
                    </td>
                    <td className="num">{g.rowCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {groups.some((g) => g.scrapAmount === null) ? (
          <p className="small muted" style={{ padding: "0 16px" }}>
            金额栏显示「未维护」= 该组物料在主数据里<b>没有标准价</b>。
            这部分**不按 0 计入金额**,数量口径不受影响;标准价可在物料批量导入时用
            「标准价(STD)」列一并维护。
          </p>
        ) : null}
        {groups.some((g) => g.key === UNKNOWN_KEY) ? (
          <p className="small muted" style={{ padding: "8px 16px" }}>
            「未填」是该维度<b>没有值</b>的记录,单列一档、固定排末尾 ——
            不并进任何一个具体分组,也不允许它凭量大挤掉真正可归因的项。
          </p>
        ) : null}
      </Card>

      {/* N-12①:多月比较分析 */}
      <Card
        title="多月比较"
        sub={`最近 ${trendPeriods.length} 期 · 按${DIMENSIONS.find((d) => d.key === trendDim)?.label.replace("按", "")} · 取报废量前 20`}
        flush
      >
        <p className="small muted" style={{ padding: "8px 16px 0" }}>
          期间列是<b>固定生成的最近 {trendPeriods.length} 期</b>,不是从数据里推出来的 ——
          某一期为空说明那一期<b>没有数据</b>,可能是真的零损耗,也可能是漏导。
          两者必须能分辨,所以空期照样占一列。环比取最后两期的损耗率差(百分点);
          任一期损耗率不可算时不给环比,**不拿 0 当基准**。
        </p>
        <div className="tbl-scroll">
          <table className="tbl" data-testid="scrap-trend">
            <thead>
              <tr>
                <th>{DIMENSIONS.find((d) => d.key === trendDim)?.label.replace("按", "")}</th>
                {trendPeriods.map((p) => (
                  <th key={p} className="num">
                    {p}
                  </th>
                ))}
                <th className="num">环比(百分点)</th>
              </tr>
            </thead>
            <tbody>
              {trend.length === 0 ? (
                <tr>
                  <td
                    colSpan={trendPeriods.length + 2}
                    className="muted small"
                    style={{ textAlign: "center", padding: 24 }}
                  >
                    最近 {trendPeriods.length} 期没有损耗数据
                  </td>
                </tr>
              ) : (
                trend.map((t) => (
                  <tr key={t.key}>
                    <td className="small">
                      {t.isUnknown ? (
                        <Badge tone="gray">未填</Badge>
                      ) : trendDim === "customerId" ? (
                        (customerName.get(t.key) ?? t.key)
                      ) : (
                        t.key
                      )}
                    </td>
                    {t.cells.map((c) => (
                      <td key={c.period} className="num small">
                        {c.scrapRate === null ? (
                          <span className="muted">-</span>
                        ) : (
                          `${(Number(c.scrapRate) * 100).toFixed(2)}%`
                        )}
                        <div className="muted">{c.scrapQty}</div>
                      </td>
                    ))}
                    <td className="num">
                      {t.rateDeltaPoints === null ? (
                        <span className="muted">不可算</span>
                      ) : (
                        <span
                          style={{
                            color: Number(t.rateDeltaPoints) > 0 ? "var(--red)" : undefined,
                          }}
                        >
                          {Number(t.rateDeltaPoints) > 0 ? "+" : ""}
                          {t.rateDeltaPoints}
                        </span>
                      )}
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
