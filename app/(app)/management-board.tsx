import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { QUOTE_STATUS_LABELS, type QuoteStatusValue } from "@/lib/domain/quote-status";
import type { ManagementSnapshot } from "@/lib/server/repositories/management";

/**
 * 管理工作台(SPEC §16)。
 * 每个 KPI 都可点击下钻到明细页;所有数字由明细派生,无冗余汇总字段。
 */
export function ManagementBoard({ snapshot }: { snapshot: ManagementSnapshot }) {
  const { quotes, opo, aging, slowMoving, inventoryFetchedAt } = snapshot;
  const agedOver24 = aging.buckets.find((b) => b.minMonths >= 24);

  return (
    <div>
      <Banner tone="soft">
        <span>
          全部 KPI 由明细<b>实时派生</b>,系统不保存汇总数字;报价金额取<b>冻结快照</b>,
          无快照的版本不计入金额。库存/呆滞来自 ezPLM 只读缓存
          {inventoryFetchedAt
            ? `(缓存于 ${inventoryFetchedAt.slice(0, 16).replace("T", " ")})`
            : "(尚无缓存)"}
          ,不代表实时库存。点击卡片可下钻到明细。
        </span>
      </Banner>

      <div className="kpi-grid">
        <Link className="kpi" href="/quotes">
          <div className="kpi-label">报价总数</div>
          <div className="kpi-value">{quotes.total}</div>
          <div className="kpi-foot">已批准 {quotes.byStatus.APPROVED}</div>
        </Link>
        <Link className="kpi" href="/quotes">
          <div className="kpi-label">已批准金额</div>
          <div className="kpi-value">
            {Object.entries(quotes.approvedAmountByCurrency).length === 0
              ? "—"
              : Object.entries(quotes.approvedAmountByCurrency)
                  .map(([cur, amt]) => `${cur} ${amt}`)
                  .join(" / ")}
          </div>
          <div className="kpi-foot">取审批快照;异币种不合并</div>
        </Link>
        <Link className="kpi" href="/quotes">
          <div className="kpi-label">报价转化率</div>
          <div className="kpi-value">
            {quotes.conversionRate === null ? "—" : `${(quotes.conversionRate * 100).toFixed(1)}%`}
          </div>
          <div className="kpi-foot">
            {quotes.conversionRate === null ? "尚无终局版本,不显示为 0%" : "已批准 / 终局版本"}
          </div>
        </Link>
        <Link className={opo.errorLines > 0 ? "kpi danger" : "kpi"} href="/suppliers/opo">
          <div className="kpi-label">OPO 异常行</div>
          <div className="kpi-value">{opo.errorLines}</div>
          <div className="kpi-foot">未回复 {opo.noReplyLines} · 提示 {opo.warningLines}</div>
        </Link>
        <Link className="kpi warn" href="/inventory">
          <div className="kpi-label">呆滞物料</div>
          <div className="kpi-value">{slowMoving.slowMovingParts}</div>
          <div className="kpi-foot">
            呆滞量 {slowMoving.slowMovingQty} · 未知 {slowMoving.unknownParts}
          </div>
        </Link>
        <Link className={agedOver24 && agedOver24.count > 0 ? "kpi danger" : "kpi"} href="/inventory">
          <div className="kpi-label">DC Aging 24 月以上</div>
          <div className="kpi-value">{agedOver24?.count ?? 0}</div>
          <div className="kpi-foot">DC 未知 {aging.unknownDateCode.count} 项另计</div>
        </Link>
      </div>

      <Card
        title="库存总览与呆滞分析"
        sub="客户 docx:「请转移到管理层模块」;支持按客户 / 日期查看"
      >
        <p className="small muted" style={{ marginBottom: 8 }}>
          库存与呆滞明细在库存页,已支持<b>按客户</b>与<b>按截至日期</b>筛选。
          按客户的口径是「该客户的 BOM 用到的物料」——
          <b>库存快照本身没有客户维度</b>,不代表这些库存是为该客户备的。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href="/inventory">
            库存总览
          </Link>
          <Link className="btn" href="/inventory?asOf=">
            按日期查看
          </Link>
          <Link className="btn" href="/settings">
            ERP 同步日志
          </Link>
        </div>
      </Card>

      <Card title="报价状态分布" sub="点击上方卡片可下钻" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>状态</th>
                <th className="num">数量</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(quotes.byStatus) as QuoteStatusValue[]).map((st) => (
                <tr key={st}>
                  <td>
                    <Badge
                      tone={st === "APPROVED" ? "green" : st === "REJECTED" ? "red" : "gray"}
                    >
                      {QUOTE_STATUS_LABELS[st]}
                    </Badge>
                  </td>
                  <td className="num">{quotes.byStatus[st]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
