import { BackLink } from "@/components/shell/back-link";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { listPurchaseRequests } from "@/lib/server/repositories/purchase-request";
import { getSession } from "@/lib/server/session";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { GtbCalculator } from "./calculator";
import { MpnLink } from "@/components/ui/mpn-link";
import { formatDate, formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function PurchaseRequestPage() {
  const session = (await getSession())!;
  const items = await listPurchaseRequests(session);
  /** 缺数据一律显示「—」,不回落成 0 —— 采购申请是下单依据,凭空的 0 会直接买错量 */
  const dash = "—";
  const customers = await prisma.customer.findMany({
    where: tenantWhere(session.tenantId),
    select: { id: true, name: true },
  });
  const customerName = new Map<string, string>(customers.map((c) => [c.id, c.name]));

  return (
    <div>
      <BackLink href="/procurement/rfq" label="采购 RFQ 比价" />
      <div className="page-head">
        <div>
          <h1 className="page-title">采购申请单</h1>
          <p className="page-desc">
            由 <b>PM</b> 发起:核算建议采购量并提交采购;同 MPN 呆滞库存一并提示
          </p>
        </div>
      </div>

      {/*
        PR2-PROC-05-C:客户明确问过「GTB 运算是做何用?」。
        主标签改成「建议采购量」,GTB 作小字技术名保留 ——
        既回答了客户,也不丢掉与他原话的对应关系。公式逐项拆解由计算器渲染。
      */}
      <Banner tone="warn">
        <span>
          <b>建议采购量</b>(小字:GTB / Gross To Buy)= 需求量 + 损耗 − 可用库存 −
          可用 Excess − 在途,再按 MOQ / SPQ 向上圆整。
          <b>损耗率默认 0 且口径待甲方确认</b> —— 系统不替甲方假设损耗;
          库存与在途来自 ezPLM 只读缓存,显示的是缓存数据而非实时查询;
          <b>Excess 只提示、不自动占用</b>,尤其不跨客户占用。
        </span>
      </Banner>

      <GtbCalculator />

      <Card title="申请记录" sub={`${items.length} 条`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                {/* PR2-PROC-05:客户点名要看到的列。缺数据的显示「—」,不回落成 0 */}
                <th>单号</th>
                <th>内部料号</th>
                <th>制造商</th>
                <th>MPN</th>
                <th>客户 / 项目</th>
                <th className="num">需求量</th>
                <th>需求日期</th>
                <th className="num">库存</th>
                <th className="num">Excess</th>
                <th className="num">在途</th>
                <th className="num">建议采购量</th>
                <th className="num">选定采购量</th>
                <th>核准单价</th>
                <th>状态</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={15} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无申请单
                  </td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.code}</td>
                    <td className="small mono">{p.internalPn ?? dash}</td>
                    <td className="small">{p.manufacturer ?? dash}</td>
                    <td className="small">
                      <MpnLink mpn={p.mpn} />
                    </td>
                    <td className="small">
                      {p.customerId ? (customerName.get(p.customerId) ?? p.customerId) : dash}
                      {p.projectCode ? <div className="muted">{p.projectCode}</div> : null}
                    </td>
                    <td className="num">{p.demandQty === null ? dash : String(p.demandQty)}</td>
                    <td className="small">{formatDate(p.requiredDate, "—")}</td>
                    <td className="num">
                      {p.internalInventory === null ? dash : String(p.internalInventory)}
                    </td>
                    <td className="num">
                      {/* Excess 未接入时是 null —— 显示「未接入」而不是 0 */}
                      {p.excessQty === null ? (
                        <span className="muted" title="Excess 数据源未配置或 PM 未确认占用">
                          未接入
                        </span>
                      ) : (
                        String(p.excessQty)
                      )}
                    </td>
                    <td className="num">{p.openPoQty === null ? dash : String(p.openPoQty)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {String(p.qty)}
                    </td>
                    <td className="num">
                      {p.selectedBuyQty === null ? dash : String(p.selectedBuyQty)}
                    </td>
                    <td className="small">
                      {p.approvedUnitPrice === null
                        ? dash
                        : `${p.currency ?? ""} ${String(p.approvedUnitPrice)}`}
                    </td>
                    <td className="small">{p.status}</td>
                    <td className="small">{formatDateTime(p.createdAt)}</td>
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
