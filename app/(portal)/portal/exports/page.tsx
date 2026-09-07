import { requirePortalPage } from "../require";

export const dynamic = "force-dynamic";

/** F6-B:导出(CSV 只含白名单字段,customer scope) */
export default async function PortalExportsPage() {
  await requirePortalPage();
  return (
    <div>
      <h1 style={{ fontSize: 20 }}>导出</h1>
      <p style={{ fontSize: 14 }}>
        <a href="/api/portal/export" data-testid="portal-export-link">
          下载我的库存(CSV)
        </a>
      </p>
      <p style={{ fontSize: 12, color: "#888" }}>导出仅包含贵司数据与门户可见字段。</p>
    </div>
  );
}
