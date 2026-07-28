import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { ProviderType } from "@prisma/client";
import { getProcurementPolicy } from "@/lib/server/repositories/procurement-policy";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { PolicyForm, SupplierOfferForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const session = (await getSession())!;
  const [policy, suppliers, offers] = await Promise.all([
    getProcurementPolicy(session.tenantId),
    prisma.supplier.findMany({
      where: tenantWhere(session.tenantId, { isActive: true }),
      orderBy: { priority: "asc" },
    }),
    prisma.supplierOffer.findMany({
      where: tenantWhere(session.tenantId, { provider: ProviderType.OFFLINE }),
      orderBy: { createdAt: "desc" },
      include: { priceBreaks: { orderBy: { minQty: "asc" } } },
      take: 50,
    }),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, `${s.code} · ${s.name}`]));
  const canEdit = session.roles.some((r) => r === "PROCUREMENT" || r === "MANAGEMENT");

  return (
    <div>
      <BackLink href="/procurement/rfq" label="采购 RFQ 比价" />
      <div className="page-head">
        <div>
          <h1 className="page-title">供应商与采购策略</h1>
          <p className="page-desc">供应商预设(MOQ / LT / 多阶价格)与异常判定阈值维护</p>
        </div>
      </div>

      {!policy.confirmedByBusiness ? (
        <Banner tone="warn">
          <span>
            当前异常判定阈值
            <b>{policy.isFallback ? "尚未配置(使用兜底值)" : "口径未经业务确认"}</b>,
            仅供演示,<b>不得作为正式风控依据</b>。确认口径后请勾选「口径已业务确认」。
          </span>
        </Banner>
      ) : null}

      <PolicyForm policy={policy} readOnly={!canEdit} />

      <Card title="供应商优先级" sub="数值越小越优先,参与比价排名" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>编码</th>
                <th>名称</th>
                <th className="num">优先级</th>
                <th>默认币种</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="mono small">{s.code}</td>
                  <td>{s.name}</td>
                  <td className="num">{s.priority}</td>
                  <td className="small">{s.defaultCurrency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canEdit ? (
        <SupplierOfferForm
          suppliers={suppliers.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))}
        />
      ) : null}

      <Card title="已维护的供应商预设" sub={`${offers.length} 条`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>供应商</th>
                <th>MPN</th>
                <th>制造商</th>
                <th className="num">MOQ</th>
                <th className="num">SPQ</th>
                <th className="num">LT(天)</th>
                <th>价格阶梯</th>
              </tr>
            </thead>
            <tbody>
              {offers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无预设数据
                  </td>
                </tr>
              ) : (
                offers.map((o) => (
                  <tr key={o.id}>
                    <td className="small">{supplierName.get(o.supplierId ?? "") ?? "-"}</td>
                    <td className="mono small">{o.mpn}</td>
                    <td className="small">{o.manufacturer ?? "-"}</td>
                    <td className="num">{o.moq === null ? "-" : String(o.moq)}</td>
                    <td className="num">{o.spq === null ? "-" : String(o.spq)}</td>
                    <td className="num">{o.leadTimeDays ?? "-"}</td>
                    <td className="small">
                      {o.priceBreaks.map((b) => (
                        <Badge key={b.id} tone="gray">
                          ≥{String(b.minQty)}:{o.currency} {String(b.unitPrice)}
                        </Badge>
                      ))}
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
