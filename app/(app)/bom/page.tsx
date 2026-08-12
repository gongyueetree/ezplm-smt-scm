import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PreBomBulk } from "./pre-bom-bulk";
import { DEFAULT_STALE_DAYS, daysSinceUpdate, deriveBomLedgerKpi } from "@/lib/domain/bom-ledger";
import { prisma } from "@/lib/server/db";
import { loadBomLedger } from "@/lib/server/repositories/bom-ledger";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const dynamic = "force-dynamic";

/** 下钻视图:点 KPI 卡片进来时自动筛好,不用二次筛选(客户 docx 明确抱怨过) */
const FOCUS_KEYS = ["eol", "stale", "unconfirmed", "no-candidate", "no-version"] as const;
type FocusKey = (typeof FOCUS_KEYS)[number];

const FOCUS_LABEL: Record<FocusKey, string> = {
  eol: "含 EOL 停产物料",
  stale: "超期未更新",
  unconfirmed: "有待人工确认行",
  "no-candidate": "有无候选行",
  "no-version": "尚无版本",
};

export default async function BomListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;
  const focus = FOCUS_KEYS.includes(sp.focus as FocusKey) ? (sp.focus as FocusKey) : null;
  const purpose =
    sp.purpose === "PRE_QUOTE" || sp.purpose === "PRODUCTION" ? sp.purpose : null;
  const staleDays = Number.isFinite(Number(sp.staleDays))
    ? Math.max(1, Number(sp.staleDays))
    : DEFAULT_STALE_DAYS;
  const today = new Date().toISOString();

  const [items, customers] = await Promise.all([
    loadBomLedger(session, {
      customerId: sp.customerId ?? null,
      from: sp.from ?? null,
      to: sp.to ?? null,
      purpose,
    }),
    prisma.customer.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const kpi = deriveBomLedgerKpi(items, { today, staleDays });

  const focusIds = new Set(
    focus === "eol"
      ? kpi.eolAffected.bomIds
      : focus === "stale"
        ? kpi.stale.bomIds
        : focus === "unconfirmed"
          ? kpi.unconfirmed.bomIds
          : focus === "no-candidate"
            ? kpi.noCandidate.bomIds
            : focus === "no-version"
              ? kpi.noVersion.bomIds
              : [],
  );
  const rows = focus ? items.filter((i) => focusIds.has(i.bomId)) : items;

  const q = new URLSearchParams();
  if (sp.customerId) q.set("customerId", sp.customerId);
  if (purpose) q.set("purpose", purpose);
  if (sp.from) q.set("from", sp.from);
  if (sp.to) q.set("to", sp.to);
  if (sp.staleDays) q.set("staleDays", String(staleDays));
  const withFocus = (f: FocusKey | null) => {
    const p = new URLSearchParams(q);
    if (f) p.set("focus", f);
    const s = p.toString();
    return s ? `/bom?${s}` : "/bom";
  };
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  return (
    <div>
      <PageHeader
        path="/bom"
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Link className="btn" href="/bom/imports">
              导入历史
            </Link>
            <Link className="btn primary" href="/bom/import">
              导入 BOM
            </Link>
          </div>
        }
      />

      <Banner tone="soft">
        <span>
          指标全部由<b>行级</b>派生;点卡片即按该指标<b>自动筛选</b>,不必二次筛。
          <b>生命周期未知不算 EOL</b> —— 本地库没有这颗料是「不知道」,既不是在产也不是停产;
          当前有 <b>{kpi.unknownLifecycleLines}</b> 行生命周期未知,EOL 指标不覆盖这部分。
          「超期未更新」按 <b>{staleDays} 天</b> 判定,该口径<b>未经业务确认</b>,可在下方调整。
          <br />
          <b>预 BOM(报价用)与正式 BOM(量产用)是两份文件</b>:正式 BOM 只能由预 BOM
          <b>转换生成</b>,转换不会改动原预 BOM。拆分功能上线前导入的 BOM 一律显示为
          <b>预 BOM</b> —— 那是默认值,不代表当时判定过它不能投产。
        </span>
      </Banner>

      <div className="kpi-grid">
        <Link className="kpi" href={withFocus(null)}>
          <div className="kpi-label">BOM 总数</div>
          <div className="kpi-value">{kpi.totalBoms}</div>
          <div className="kpi-foot">点此清除下钻</div>
        </Link>
        <Link className={kpi.eolAffected.count > 0 ? "kpi danger" : "kpi"} href={withFocus("eol")}>
          <div className="kpi-label">EOL 物料占用 BOM</div>
          <div className="kpi-value">{kpi.eolAffected.count}</div>
          <div className="kpi-foot">涉及 {kpi.eolAffected.lineCount} 行</div>
        </Link>
        <Link className={kpi.stale.count > 0 ? "kpi warn" : "kpi"} href={withFocus("stale")}>
          <div className="kpi-label">超期未更新 BOM</div>
          <div className="kpi-value">{kpi.stale.count}</div>
          <div className="kpi-foot">超过 {staleDays} 天</div>
        </Link>
        <Link
          className={kpi.unconfirmed.count > 0 ? "kpi danger" : "kpi"}
          href={withFocus("unconfirmed")}
        >
          <div className="kpi-label">需人工确认物料</div>
          <div className="kpi-value">{kpi.unconfirmed.lineCount}</div>
          <div className="kpi-foot">分布在 {kpi.unconfirmed.count} 个 BOM</div>
        </Link>
        <Link
          className={kpi.noCandidate.count > 0 ? "kpi danger" : "kpi"}
          href={withFocus("no-candidate")}
        >
          <div className="kpi-label">未识别物料</div>
          <div className="kpi-value">{kpi.noCandidate.lineCount}</div>
          <div className="kpi-foot">分布在 {kpi.noCandidate.count} 个 BOM</div>
        </Link>
      </div>

      {/* E4:客户 Q9 点名的批量入口 —— 放在筛选之前,一眼看得见 */}
      <Card
        title="批量导入 / 导出预 BOM"
        sub="一次多个文件,每个文件各自生成一份预 BOM;导出附导入状态与待人工行数"
      >
        <PreBomBulk
          selectableBoms={items.slice(0, 200).map((b) => ({
            id: b.bomId,
            label: `${b.name}${b.purpose === "PRODUCTION" ? "(正式)" : ""} · ${b.lineCount} 行`,
          }))}
        />
      </Card>

      <Card title="筛选" sub="客户 / 时间 / 指标下钻可组合">
        <form
          method="get"
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          {focus ? <input type="hidden" name="focus" value={focus} /> : null}
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
            <span>用途</span>
            <select name="purpose" defaultValue={purpose ?? ""}>
              <option value="">全部</option>
              <option value="PRE_QUOTE">预 BOM(报价用)</option>
              <option value="PRODUCTION">正式 BOM(量产用)</option>
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>创建起</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>创建止</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>超期天数口径</span>
            <input
              type="number"
              name="staleDays"
              min={1}
              defaultValue={staleDays}
              style={{ width: 100 }}
            />
          </label>
          <button className="btn" type="submit">
            筛选
          </button>
          <Link className="btn" href="/bom">
            重置
          </Link>
          <a className="btn" href={`/api/bom/ledger/export?${q.toString()}`}>
            批量导出清单
          </a>
          <a className="btn" href={`/api/bom/ledger/export?kind=issues&${q.toString()}`}>
            批量导出异常物料
          </a>
        </form>
      </Card>

      <Card
        title="BOM 台账"
        sub={focus ? `已下钻:${FOCUS_LABEL[focus]} · ${rows.length} 个` : `${rows.length} 个`}
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>BOM</th>
                <th>用途</th>
                <th>客户</th>
                <th>关联 RFQ</th>
                <th className="num">版本</th>
                <th className="num">行数</th>
                <th className="num">EOL / 待确认 / 无候选</th>
                <th>最近更新</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="muted small"
                    style={{ textAlign: "center", padding: 24 }}
                  >
                    {focus ? "该指标下暂无 BOM" : "暂无 BOM,点击右上角「导入 BOM」"}
                  </td>
                </tr>
              ) : (
                rows.map((b) => {
                  const age = daysSinceUpdate(b.latestVersionAt, today);
                  const isStale = age !== null && age > staleDays;
                  return (
                    <tr key={b.bomId}>
                      <td>{b.name}</td>
                      <td className="small">
                        {b.purpose === "PRODUCTION" ? (
                          <>
                            <Badge tone="green">正式 BOM</Badge>
                            {b.pendingInternalPnCount > 0 ? (
                              <div style={{ color: "var(--danger)" }}>
                                待补内部料号 {b.pendingInternalPnCount} 行
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <Badge tone="gray">预 BOM</Badge>
                            {b.convertedToCount > 0 ? (
                              <div className="muted">已转出 {b.convertedToCount} 份正式 BOM</div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="small">
                        {b.customerId ? (customerName.get(b.customerId) ?? b.customerId) : "-"}
                      </td>
                      <td className="small">
                        {b.rfqId ? <Link href={`/rfq/${b.rfqId}`}>{b.rfqCode}</Link> : "-"}
                      </td>
                      <td className="num">
                        <Badge tone="gray">V{b.latestVersionNo ?? "-"}</Badge>
                      </td>
                      <td className="num">{b.lineCount}</td>
                      <td className="num small">
                        <span style={{ color: b.eolLineCount > 0 ? "var(--danger)" : undefined }}>
                          {b.eolLineCount}
                        </span>
                        {" / "}
                        <span
                          style={{ color: b.unconfirmedLineCount > 0 ? "var(--danger)" : undefined }}
                        >
                          {b.unconfirmedLineCount}
                        </span>
                        {" / "}
                        <span
                          style={{ color: b.noCandidateLineCount > 0 ? "var(--danger)" : undefined }}
                        >
                          {b.noCandidateLineCount}
                        </span>
                        {b.unknownLifecycleLineCount > 0 ? (
                          <div className="muted">生命周期未知 {b.unknownLifecycleLineCount} 行</div>
                        ) : null}
                      </td>
                      <td className="small">
                        {b.latestVersionAt ? (
                          <>
                            {b.latestVersionAt.slice(0, 10)}
                            <div
                              className={isStale ? undefined : "muted"}
                              style={isStale ? { color: "var(--danger)" } : undefined}
                            >
                              {age} 天前{isStale ? " · 超期" : ""}
                            </div>
                          </>
                        ) : (
                          <span className="muted">尚无版本</span>
                        )}
                      </td>
                      <td>
                        {b.latestVersionId ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <Link className="btn sm" href={`/bom/version/${b.latestVersionId}`}>
                              匹配确认
                            </Link>
                            {b.previousVersionId ? (
                              <Link
                                className="btn sm"
                                href={`/bom/compare?from=${b.previousVersionId}&to=${b.latestVersionId}`}
                              >
                                版本比对
                              </Link>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
