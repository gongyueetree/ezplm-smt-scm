import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

/**
 * BOM 导入历史台账(客户 docx:「无历史导入记录台账,无法追溯过往上传 BOM 文件」)。
 *
 * 全部由 BOMImportJob 派生 —— 不另存一份汇总,避免两处计数打架。
 */
const STATUS: Record<string, { text: string; tone: "gray" | "blue" | "green" | "red" }> = {
  PENDING: { text: "排队中", tone: "gray" },
  RUNNING: { text: "处理中", tone: "blue" },
  SUCCEEDED: { text: "已完成", tone: "green" },
  FAILED: { text: "失败", tone: "red" },
};

export default async function BomImportLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = (await getSession())!;
  const sp = await searchParams;

  const where: Record<string, unknown> = {};
  if (sp.status && STATUS[sp.status]) where.status = sp.status;
  if (sp.from || sp.to) {
    where.createdAt = {
      ...(sp.from ? { gte: new Date(sp.from) } : {}),
      ...(sp.to ? { lte: new Date(sp.to) } : {}),
    };
  }

  const jobs = await prisma.bOMImportJob.findMany({
    where: tenantWhere(session.tenantId, where),
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const bomIds = [...new Set(jobs.map((j) => j.bomId).filter(Boolean))] as string[];
  const boms = bomIds.length
    ? await prisma.bOM.findMany({
        where: tenantWhere(session.tenantId, { id: { in: bomIds } }),
        select: {
          id: true,
          name: true,
          versions: { orderBy: { versionNo: "desc" }, take: 2, select: { id: true, versionNo: true } },
        },
      })
    : [];
  const bomById = new Map(boms.map((b) => [b.id, b]));

  /** 优先用留存的原始文件名;老记录没有这一段时退回存储键末段并如实标注 */
  const displayNames = (job: { fileNames: unknown; fileKeys: unknown }): string[] => {
    if (Array.isArray(job.fileNames) && job.fileNames.length > 0) {
      return job.fileNames.map(String);
    }
    if (Array.isArray(job.fileKeys)) {
      return job.fileKeys.map((x) => `${String(x).split("/").pop()}(未留存原名)`);
    }
    return [];
  };

  return (
    <div>
      <PageHeader
        path="/bom/imports"
        actions={
          <Link className="btn primary" href="/bom/import">
            导入 BOM
          </Link>
        }
      />

      <Banner tone="soft">
        <span>
          本台账由导入作业记录派生,可追溯每次上传的<b>原始文件名</b>、处理进度与结果。
          导入采用<b>幂等键</b>去重:同一份文件在解析规则未变时会复用既有版本,
          此时不会产生新版本 —— 台账里看到「已完成」但版本号没变即为此种情形。
        </span>
      </Banner>

      <Card title="筛选" sub="状态 / 时间">
        <form
          method="get"
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>状态</span>
            <select name="status" defaultValue={sp.status ?? ""}>
              <option value="">全部</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.text}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>起</span>
            <input type="date" name="from" defaultValue={sp.from ?? ""} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>止</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} />
          </label>
          <button className="btn" type="submit">
            筛选
          </button>
          <Link className="btn" href="/bom/imports">
            重置
          </Link>
        </form>
      </Card>

      <Card title="导入历史" sub={`${jobs.length} 条(近 200)`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>时间</th>
                <th>原始文件</th>
                <th>目标 BOM</th>
                <th>状态</th>
                <th className="num">进度</th>
                <th>结果 / 错误</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="muted small"
                    style={{ textAlign: "center", padding: 24 }}
                  >
                    暂无导入记录
                  </td>
                </tr>
              ) : (
                jobs.map((j) => {
                  const bom = j.bomId ? bomById.get(j.bomId) : null;
                  const latest = bom?.versions[0];
                  const prev = bom?.versions[1];
                  return (
                    <tr key={j.id}>
                      <td className="small">
                        {formatDateTime(j.createdAt)}
                      </td>
                      <td className="small mono">
                        {displayNames(j).length > 0
                          ? displayNames(j).map((f, i) => <div key={i}>{f}</div>)
                          : "—"}
                      </td>
                      <td className="small">
                        {bom ? bom.name : <span className="muted">—</span>}
                      </td>
                      <td>
                        <Badge tone={STATUS[j.status]?.tone ?? "gray"}>
                          {STATUS[j.status]?.text ?? j.status}
                        </Badge>
                      </td>
                      <td className="num small">
                        {j.processedLines} / {j.totalLines}
                      </td>
                      <td className="small muted">{j.error ?? "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          {latest ? (
                            <Link className="btn xs" href={`/bom/version/${latest.id}`}>
                              匹配确认
                            </Link>
                          ) : null}
                          {latest && prev ? (
                            <Link
                              className="btn xs"
                              href={`/bom/compare?from=${prev.id}&to=${latest.id}`}
                            >
                              版本比对
                            </Link>
                          ) : null}
                        </div>
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
