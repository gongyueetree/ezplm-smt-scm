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
  const {
    quotes,
    conversion,
    conversionTruncated,
    margin,
    opo,
    aging,
    slowMoving,
    inventoryFetchedAt,
    excess,
    shortage,
    scrap,
    quality,
  } = snapshot;
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
          {/*
            「不是成单率」这句**不放进条件分支**。
            原来它只在有终局版本时才出现 —— 可是没有数据的时候,
            「审批通过率」这个标题一样在,一样会被读成成单率,
            甚至更容易(值是「—」,人只会去看标题)。
            澄清口径的话在任何数据状态下都必须在。
            (CI 就是在全新种子库上把这条打红的:本地开发库里攒了终局版本,
             正好走到了另一个分支,于是本地绿、CI 红。)
          */}
          <div className="kpi-foot" data-testid="approval-rate-foot">
            {quotes.approvalPassRate === null ? "尚无终局版本,不显示为 0%" : "已批准 / 终局版本"}
            {" —— 内部流程指标,不是成单率"}
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
        {/*
          F1 新增五卡。风险语义统一:kpi danger = critical、kpi warn = warning、
          kpi = normal —— 复用既有样式,不另起一套 class。
          每卡可下钻且**带过滤参数**;数据源没接入就明说,不显示 0 充数。
        */}
        <Link className="kpi" href="/quotes">
          <div className="kpi-label">毛利(已批准报价)</div>
          <div className="kpi-value" data-testid="kpi-margin">
            {margin.byCurrency.length === 0
              ? "—"
              : margin.byCurrency
                  .map((c) => `${c.currency} ${(Number(c.marginPct ?? 0) * 100).toFixed(1)}%`)
                  .join(" / ")}
          </div>
          <div className="kpi-foot">
            {margin.byCurrency.length === 0
              ? margin.excluded.length > 0
                ? `${margin.excluded.length} 张已批准报价因行级缺成本无法计算 —— 不显示估算值`
                : "尚无可计算的已批准报价"
              : `可算 ${margin.computableQuotes} 张${margin.excluded.length > 0 ? ` · ${margin.excluded.length} 张缺成本被排除` : ""} · 成本取冻结行,快照缺成本会虚高`}
          </div>
        </Link>
        <Link
          className="kpi"
          href="/procurement/request"
          data-testid="kpi-excess"
        >
          <div className="kpi-label">Excess 呆滞可用</div>
          <div className="kpi-value">
            {excess.state === "NOT_CONFIGURED" ? "待接入" : excess.totalQty}
          </div>
          <div className="kpi-foot">
            {excess.state === "NOT_CONFIGURED"
              ? "数据源待接入(ERP Excess Report,凭据未到)—— 不按 0 显示"
              : `${excess.lineCount} 行 · 快照 ${excess.snapshotAt?.slice(0, 10) ?? ""}`}
          </div>
        </Link>
        <Link
          className={shortage.openLines > 0 ? "kpi danger" : "kpi"}
          href="/shortage"
          data-testid="kpi-shortage"
        >
          <div className="kpi-label">未解决缺料行</div>
          <div className="kpi-value">{shortage.openLines}</div>
          <div className="kpi-foot">已解决 {shortage.resolvedLines} · 共 {shortage.totalLines}(缺料单口径)</div>
        </Link>
        <Link className="kpi warn" href={`/scrap?period=${scrap.period}`} data-testid="kpi-scrap">
          <div className="kpi-label">当月损耗</div>
          <div className="kpi-value">{scrap.recordCount === 0 ? "—" : scrap.scrapQty}</div>
          <div className="kpi-foot">
            {scrap.recordCount === 0
              ? `${scrap.period} 暂无损耗记录`
              : scrap.amount
                ? `金额 ${scrap.amountCurrency} ${scrap.amount}${scrap.unpricedCount > 0 ? ` · ${scrap.unpricedCount} 行缺标准价未计入` : ""}`
                : `${scrap.unpricedCount} 行缺标准价,金额未知 —— 不按 0 算`}
          </div>
        </Link>
        <Link
          className={quality.open > 0 ? "kpi danger" : "kpi"}
          href="/quality"
          data-testid="kpi-quality"
        >
          <div className="kpi-label">质量事件(未关闭)</div>
          <div className="kpi-value">{quality.open + quality.investigating + quality.contained}</div>
          <div className="kpi-foot">
            客诉 {quality.customerComplaints} · 供应商 {quality.supplierIssues} · 本月关闭 {quality.closedThisMonth}
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
