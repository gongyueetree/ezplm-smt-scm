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
  const { quotes, conversion, conversionTruncated, opo, aging, slowMoving, inventoryFetchedAt } =
    snapshot;
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
          <br />
          <b>「订单转化率」与「审批通过率」是两个指标</b>:前者靠 PM 在报价单上
          人工标记中标(系统没有 ERP 订单对接,不做任何自动判定),
          后者只反映内部审批流程。
          {conversion.wonWithoutAmount > 0 ? (
            <>
              {" "}
              另有 <b>{conversion.wonWithoutAmount}</b> 张已中标报价没有冻结快照金额,
              <b>未计入中标金额</b>(不按 0 计)。
            </>
          ) : null}
          {conversionTruncated ? (
            <>
              {" "}
              <b>报价数超过统计上限,订单转化率只覆盖了最近的一批</b>,不是全量口径。
            </>
          ) : null}
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
        {/*
          PR-D:把两个指标**拆开**。
          原来只有一张卡片写着「报价转化率」,算的却是 已批准/终局版本 ——
          那是内部审批通过率。管理层看着它做的是"我们成单率不错"的判断,
          而它其实一次都没碰过客户下没下单。
        */}
        <Link className="kpi" href="/quotes?outcome=WON">
          <div className="kpi-label">订单转化率</div>
          <div className="kpi-value">
            {conversion.orderConversionRate === null
              ? "—"
              : `${(conversion.orderConversionRate * 100).toFixed(1)}%`}
          </div>
          <div className="kpi-foot">
            {conversion.orderConversionRate === null
              ? "尚无已定局的报价,不显示为 0%"
              : `已中标 ${conversion.byOutcome.WON} / 已定局 ${
                  conversion.byOutcome.WON + conversion.byOutcome.LOST + conversion.byOutcome.EXPIRED
                } · 待定 ${conversion.pending} 张不进分母`}
          </div>
        </Link>
        <Link className="kpi" href="/quotes">
          <div className="kpi-label">审批通过率</div>
          <div className="kpi-value">
            {quotes.approvalPassRate === null ? "—" : `${(quotes.approvalPassRate * 100).toFixed(1)}%`}
          </div>
          <div className="kpi-foot">
            {quotes.approvalPassRate === null
              ? "尚无终局版本,不显示为 0%"
              : "已批准 / 终局版本 —— 内部流程指标,不是成单率"}
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
