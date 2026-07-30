import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { QUOTE_STATUS_LABELS, type QuoteStatusValue } from "@/lib/domain/quote-status";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { CreateQuoteForm } from "./create-form";
import { BatchUpdateQuotes } from "./batch-update";

export const dynamic = "force-dynamic";

const TONE: Record<QuoteStatusValue, "gray" | "amber" | "green" | "red"> = {
  DRAFT: "gray",
  PENDING_APPROVAL: "amber",
  APPROVED: "green",
  REJECTED: "red",
  EXPIRED: "gray",
};

export default async function QuotesPage() {
  const session = (await getSession())!;
  const [quotes, rfqs, bomVersions] = await Promise.all([
    prisma.quote.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      include: { versions: { orderBy: { revision: "desc" } } },
    }),
    prisma.rFQ.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      select: { id: true, code: true, title: true, customerId: true },
      take: 50,
    }),
    prisma.bOMVersion.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { createdAt: "desc" },
      include: { bom: { select: { name: true } } },
      take: 50,
    }),
  ]);
  const canCreate = session.roles.some((r) => r === "PM" || r === "MANAGEMENT");

  return (
    <div>
      <PageHeader path="/quotes" />
      <Banner tone="ai">
        <span>
          金额一律由<b>确定性函数</b>计算,AI 只给分类与 Markup <b>建议</b>且须人工确认卡片批准;
          提交审批后<b>参数全冻结</b>,改动只能走<b>新 Revision</b>(禁止覆盖已批准版本);
          正式 PDF/XLSX <b>只用快照</b>。
        </span>
      </Banner>

      {canCreate ? <CreateQuoteForm rfqs={rfqs} /> : <Banner tone="soft">仅 PM 与管理层可创建报价。</Banner>}
      {canCreate ? (
        <BatchUpdateQuotes
          bomVersions={bomVersions.map((v) => ({
            id: v.id,
            label: `${v.bom.name} V${v.versionNo}`,
          }))}
        />
      ) : null}

      <Card title="报价列表" sub={`${quotes.length} 个`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>编号</th>
                <th className="num">版本</th>
                <th>最新状态</th>
                <th>历史版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无报价
                  </td>
                </tr>
              ) : (
                quotes.map((q) => {
                  const latest = q.versions[0];
                  return (
                    <tr key={q.id}>
                      <td style={{ fontWeight: 600 }}>{q.code}</td>
                      <td className="num">R{latest?.revision ?? "-"}</td>
                      <td>
                        {latest ? (
                          <Badge tone={TONE[latest.status as QuoteStatusValue]}>
                            {QUOTE_STATUS_LABELS[latest.status as QuoteStatusValue]}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="small muted">
                        {q.versions
                          .map((v) => `R${v.revision}:${QUOTE_STATUS_LABELS[v.status as QuoteStatusValue]}`)
                          .join(" · ")}
                      </td>
                      <td>
                        {latest ? (
                          <Link className="btn sm" href={`/quotes/${latest.id}`}>
                            打开
                          </Link>
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
