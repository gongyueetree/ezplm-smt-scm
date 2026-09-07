import { portalInventory } from "@/lib/server/portal";
import { requirePortalPage } from "../require";

export const dynamic = "force-dynamic";

/** F6-B:我的库存(白名单字段;scope 由会话决定) */
export default async function PortalInventoryPage() {
  const session = await requirePortalPage();
  const inv = await portalInventory(session);

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>我的库存</h1>
      {inv.state !== "ok" ? (
        <p data-testid="portal-inventory-empty" style={{ color: "#888" }}>
          {inv.note} —— 接入后此处显示贵司库存;当前不显示任何数字。
        </p>
      ) : (
        <table style={{ width: "100%", background: "#fff", borderRadius: 10, borderCollapse: "collapse", marginTop: 12 }} data-testid="portal-inventory-table">
          <thead>
            <tr>
              {["物料编码", "数量", "仓库", "批次", "数据更新时间"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 13 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inv.rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#888" }}>
                  暂无归属贵司的库存记录
                </td>
              </tr>
            ) : (
              inv.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.materialCode}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.qty}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.warehouse ?? "—"}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.lotNo ?? "—"}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.updatedAt ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
      {inv.note && inv.state === "ok" ? <p style={{ fontSize: 12, color: "#888" }}>{inv.note}</p> : null}
    </div>
  );
}
