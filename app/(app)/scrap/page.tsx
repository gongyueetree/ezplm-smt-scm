import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  groupScrap,
  summarizeScrap,
  UNKNOWN_KEY,
  type ScrapDimension,
  type ScrapRow,
} from "@/lib/domain/scrap-report";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { ScrapImport } from "./import-form";

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
  const groups = groupScrap(rows, dim);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

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
                <th className="num">记录数</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
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
                    <td className="num">{g.rowCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {groups.some((g) => g.key === UNKNOWN_KEY) ? (
          <p className="small muted" style={{ padding: "8px 16px" }}>
            「未填」是该维度<b>没有值</b>的记录,单列一档、固定排末尾 ——
            不并进任何一个具体分组,也不允许它凭量大挤掉真正可归因的项。
          </p>
        ) : null}
      </Card>
    </div>
  );
}
