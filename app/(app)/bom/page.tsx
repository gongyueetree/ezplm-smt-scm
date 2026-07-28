import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const dynamic = "force-dynamic";

export default async function BomListPage() {
  const session = (await getSession())!;
  const boms = await prisma.bOM.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: {
      versions: { orderBy: { versionNo: "desc" }, include: { _count: { select: { lines: true } } } },
      rfq: { select: { code: true, id: true } },
    },
  });

  return (
    <div>
      <PageHeader
        path="/bom"
        actions={
          <Link className="btn primary" href="/bom/import">
            导入 BOM
          </Link>
        }
      />
      <Card title="BOM 台账" sub={`${boms.length} 个`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>BOM</th>
                <th>关联 RFQ</th>
                <th className="num">版本</th>
                <th className="num">行数</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {boms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    暂无 BOM,点击右上角「导入 BOM」
                  </td>
                </tr>
              ) : (
                boms.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td className="small">
                      {b.rfq ? <Link href={`/rfq/${b.rfq.id}`}>{b.rfq.code}</Link> : "-"}
                    </td>
                    <td className="num">
                      <Badge tone="gray">V{b.versions[0]?.versionNo ?? "-"}</Badge>
                    </td>
                    <td className="num">{b.versions[0]?._count.lines ?? 0}</td>
                    <td className="small">{b.createdAt.toISOString().slice(0, 10)}</td>
                    <td>
                      {b.versions[0] ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <Link className="btn sm" href={`/bom/version/${b.versions[0].id}`}>
                            匹配确认
                          </Link>
                          {b.versions.length > 1 ? (
                            <Link
                              className="btn sm"
                              href={`/bom/compare?from=${b.versions[1].id}&to=${b.versions[0].id}`}
                            >
                              版本比对
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
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
