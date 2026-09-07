import { portalInventory } from "@/lib/server/portal";
import { requirePortalPage } from "./require";

export const dynamic = "force-dynamic";

/** F6-B:门户总览。KPI 只在有真实数据时计算;缺源如实「待接入」 */
export default async function PortalOverview() {
  const session = await requirePortalPage();
  const inv = await portalInventory(session);

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>总览</h1>
      <div style={{ display: "flex", gap: 16, marginTop: 12 }} data-testid="portal-kpis">
        <div style={{ background: "#fff", borderRadius: 10, padding: 16, minWidth: 180 }}>
          <div style={{ fontSize: 13, color: "#888" }}>库存物料数</div>
          <div style={{ fontSize: 24, fontWeight: 700 }} data-testid="portal-kpi-inventory">
            {inv.state === "ok" ? new Set(inv.rows.map((r) => r.materialCode)).size : "待接入"}
          </div>
          {inv.state !== "ok" ? (
            <div style={{ fontSize: 12, color: "#888" }}>{inv.note}</div>
          ) : (
            <div style={{ fontSize: 12, color: "#888" }}>取数 {inv.fetchedAt?.slice(0, 16).replace("T", " ")}</div>
          )}
        </div>
      </div>
      <p style={{ fontSize: 13, color: "#888", marginTop: 16 }}>
        本门户仅展示贵司自有数据;出入流水与批次数据源接入后开放。
      </p>
    </div>
  );
}
