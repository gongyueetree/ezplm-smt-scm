import { notFound } from "next/navigation";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import {
  DISPOSITION_LABEL,
  NEEDS_REVIEW_DISPOSITIONS,
  type ImportReconciliation,
  type RowDisposition,
} from "@/lib/domain/bom-parse";
import { formatDateTime } from "@/lib/format/datetime";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const dynamic = "force-dynamic";

/** 一次最多展示的原始行数;超过时**明说**被截断,不静默少显示 */
const ROW_CAP = 500;

const TONE: Record<RowDisposition, "green" | "gray" | "amber"> = {
  RECOGNIZED: "green",
  MERGED_INTO_PREVIOUS: "gray",
  BLANK: "gray",
  REPEATED_HEADER: "gray",
  PAGE_FOOTER: "gray",
  NO_IDENTIFIER: "amber",
  INSUFFICIENT: "amber",
};

/**
 * E1a:导入行去向明细(客户 Q13)。
 *
 * 客户的原话是「数据会丢失」。要回答这句话,只给一个"成功导入 92 行"是不够的 ——
 * 必须能逐行说明**另外 8 行去哪了**,并且让人看到那几行的原始内容,
 * 自己判断系统处理得对不对。
 */
export default async function ImportRowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { jobId } = await params;
  const sp = await searchParams;
  const session = (await getSession())!;

  const job = await prisma.bOMImportJob.findFirst({
    where: tenantWhere(session.tenantId, { id: jobId }),
  });
  if (!job) notFound();

  const filter = sp.d && sp.d in DISPOSITION_LABEL ? (sp.d as RowDisposition) : null;
  const rows = await prisma.rawBomRow.findMany({
    where: tenantWhere(session.tenantId, {
      importJobId: jobId,
      ...(filter ? { disposition: filter } : {}),
    }),
    orderBy: { sourceRow: "asc" },
    take: ROW_CAP + 1,
  });
  const truncated = rows.length > ROW_CAP;
  const shown = rows.slice(0, ROW_CAP);

  const recon = job.reconciliation as unknown as ImportReconciliation | null;
  const fileNames = (job.fileNames as unknown as string[] | null) ?? [];

  return (
    <div>
      <BackLink href="/bom/imports" label="导入历史" />
      <div className="page-head">
        <div>
          <h1 className="page-title">行去向明细</h1>
          <p className="page-desc">
            {fileNames.join("、") || "(文件名未记录)"} · 导入于 {formatDateTime(job.createdAt)}
          </p>
        </div>
      </div>

      {recon === null ? (
        <Banner tone="warn">
          <span>
            这次导入<b>早于行去向功能上线</b>,没有留下逐行记录。
            以后的导入都会有;这一份如需核对,请重新导入一次原文件。
          </span>
        </Banner>
      ) : (
        <>
          <Banner tone={recon.balanced ? "soft" : "warn"}>
            <span>
              {recon.balanced ? (
                <>
                  <b>账已平</b>:原始 {recon.totalRows} 行 = {recon.recognized} 识别 +{" "}
                  {recon.mergedIntoPrevious} 并入 + {recon.nonBusiness} 非业务 +{" "}
                  {recon.needsReview} 待人工。<b>系统不会悄悄丢行</b> ——
                  每一行的去向都在下表里,可以逐行核对。
                </>
              ) : (
                <>
                  <b>行去向对不上账</b>:登记了 {recon.totalRows} 行,
                  但分类之和不等于它。这是<b>系统缺陷</b>,不是文件问题 ——
                  在查清之前不要以这份 BOM 为准。
                </>
              )}
            </span>
          </Banner>

          <div className="kpi-grid">
            {(Object.keys(DISPOSITION_LABEL) as RowDisposition[]).map((d) => {
              const n = recon.byDisposition[d] ?? 0;
              const needsReview = NEEDS_REVIEW_DISPOSITIONS.includes(d);
              return (
                <a
                  className={`kpi${needsReview && n > 0 ? " warn" : ""}`}
                  key={d}
                  href={`/bom/imports/${jobId}?d=${d}`}
                >
                  <div className="kpi-label">{DISPOSITION_LABEL[d]}</div>
                  <div className="kpi-value">{n}</div>
                  <div className="kpi-foot">点此只看这一类</div>
                </a>
              );
            })}
          </div>
        </>
      )}

      <Card
        title="逐行去向"
        sub={
          filter
            ? `已筛选:${DISPOSITION_LABEL[filter]} · ${shown.length} 行`
            : `${shown.length} 行`
        }
        flush
      >
        {filter ? (
          <p className="small" style={{ padding: "8px 16px 0" }}>
            <a className="btn sm" href={`/bom/imports/${jobId}`}>
              清除筛选
            </a>
          </p>
        ) : null}
        {truncated ? (
          <div className="banner warn" style={{ margin: "8px 16px" }}>
            原始行超过 {ROW_CAP} 行,本页<b>只显示前 {ROW_CAP} 行</b>。
            这不代表其余行没有记录 —— 请用上方分类筛选逐类查看。
          </div>
        ) : null}
        <div className="tbl-scroll">
          <table className="tbl" data-testid="raw-row-table">
            <thead>
              <tr>
                <th className="num">原始行号</th>
                <th>去向</th>
                <th className="num">BOM 行号</th>
                <th>说明</th>
                <th>原始内容</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    {recon === null ? "本次导入没有逐行记录" : "该分类下没有行"}
                  </td>
                </tr>
              ) : (
                shown.map((r) => {
                  const d = r.disposition as RowDisposition;
                  const cells = (r.cells as unknown as string[] | null) ?? [];
                  return (
                    <tr key={r.id}>
                      <td className="num">{r.sourceRow}</td>
                      <td>
                        <Badge tone={TONE[d] ?? "gray"}>{DISPOSITION_LABEL[d] ?? d}</Badge>
                      </td>
                      <td className="num">
                        {r.lineNo ?? (r.mergedIntoSourceRow ? `→ 第 ${r.mergedIntoSourceRow} 行` : "-")}
                      </td>
                      <td className="small muted">{r.reason}</td>
                      <td className="small">
                        {cells.filter(Boolean).join(" | ") || <span className="muted">(空)</span>}
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
