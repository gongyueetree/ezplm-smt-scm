import { BackLink } from "@/components/shell/back-link";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { listPurchaseRequests } from "@/lib/server/repositories/purchase-request";
import { getSession } from "@/lib/server/session";
import { GtbCalculator } from "./calculator";
import { MpnLink } from "@/components/ui/mpn-link";
import { formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

export default async function PurchaseRequestPage() {
  const session = (await getSession())!;
  const items = await listPurchaseRequests(session);

  return (
    <div>
      <BackLink href="/procurement/rfq" label="采购 RFQ 比价" />
      <div className="page-head">
        <div>
          <h1 className="page-title">采购申请单</h1>
          <p className="page-desc">
            PM 视角:按 GTB 核算采购量并提交采购;同 MPN 呆滞库存一并提示
          </p>
        </div>
      </div>

      <Banner tone="warn">
        <span>
          GTB = <b>ceil(需求 ×(1+损耗率)) − 库存 − 在途</b>,不低于 MOQ 再按 SPQ 向上圆整。
          <b>损耗率默认 0 且口径待甲方确认</b> —— 系统不替甲方假设损耗;
          库存与在途来自 ezPLM 只读缓存,显示的是缓存数据而非实时查询。
        </span>
      </Banner>

      <GtbCalculator />

      <Card title="申请记录" sub={`${items.length} 条`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>单号</th>
                <th>MPN</th>
                <th className="num">申请数量</th>
                <th>状态</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无申请单
                  </td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.code}</td>
                    <td className="small">
                      <MpnLink mpn={p.mpn} />
                    </td>
                    <td className="num">{String(p.qty)}</td>
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
