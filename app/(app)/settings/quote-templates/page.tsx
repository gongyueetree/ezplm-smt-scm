import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BUILTIN_LABOR_TEMPLATES } from "@/lib/domain/quote-calc";
import { pickQuoteTemplate } from "@/lib/domain/quote-template";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { TemplateEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function QuoteTemplatesPage() {
  const session = (await getSession())!;
  const [templates, customers] = await Promise.all([
    prisma.quoteTemplate.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: [{ tier: "asc" }, { name: "asc" }],
    }),
    prisma.customer.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, code: true, name: true, tier: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const refs = templates.map((t) => ({
    id: t.id,
    name: t.name,
    tier: t.tier,
    defaultMarkupPct: t.defaultMarkupPct?.toString() ?? null,
    laborTemplateId: t.laborTemplateId,
    confirmedByBusiness: t.confirmedByBusiness,
  }));

  return (
    <div>
      <PageHeader path="/settings/quote-templates" />

      <Banner tone="soft">
        <span>
          客户 xlsx:「A/B/C 类客户差异化报价规则配置,多套报价模板预设」。
          <b>系统不预设任何百分比</b> —— 默认 Markup 初始为空,由业务维护;
          未经业务确认的模板会一路标注「口径待确认」。
          模板只提供<b>默认值</b>,报价行仍可人工覆盖,金额一律由确定性函数计算。
          <b>客户未评级 ≠ C 级</b>:未评级会落到通用模板,不会被当成最低档。
        </span>
      </Banner>

      <TemplateEditor
        laborTemplates={BUILTIN_LABOR_TEMPLATES.map((t) => ({ id: t.id, name: t.name }))}
        customers={customers.map((c) => ({ id: c.id, label: `${c.name}(${c.code})`, tier: c.tier }))}
      />

      <Card title="报价模板" sub={`${templates.length} 套`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>模板</th>
                <th>适用等级</th>
                <th className="num">默认 Markup</th>
                <th>人工费率模板</th>
                <th>口径</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    尚未配置任何模板 —— 报价参数将全部需要人工填写
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      {t.tier ? <Badge tone="blue">{t.tier} 类</Badge> : <Badge tone="gray">通用</Badge>}
                    </td>
                    <td className="num">
                      {t.defaultMarkupPct === null ? (
                        <span className="muted">未维护</span>
                      ) : (
                        `${(Number(t.defaultMarkupPct) * 100).toFixed(2)}%`
                      )}
                    </td>
                    <td className="small">
                      {BUILTIN_LABOR_TEMPLATES.find((l) => l.id === t.laborTemplateId)?.name ?? "—"}
                    </td>
                    <td>
                      {t.confirmedByBusiness ? (
                        <Badge tone="green">已确认</Badge>
                      ) : (
                        <Badge tone="amber">口径待确认</Badge>
                      )}
                    </td>
                    <td className="small muted">{t.note ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="客户等级与命中的模板" sub="等级为空即未评级 —— 不等于 C 级" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>客户</th>
                <th>等级</th>
                <th>建报价时会套用</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const pick = pickQuoteTemplate(refs, c.tier);
                return (
                  <tr key={c.id}>
                    <td className="small">
                      {c.name}
                      <span className="muted"> ({c.code})</span>
                    </td>
                    <td>
                      {c.tier ? (
                        <Badge tone="blue">{c.tier} 类</Badge>
                      ) : (
                        <Badge tone="gray">未评级</Badge>
                      )}
                    </td>
                    <td className="small muted">{pick.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
