import { portalLots } from "@/lib/server/portal";
import { requirePortalPage } from "../require";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { AVAILABLE: "可用", HOLD: "冻结", CONSUMED: "已耗用" };

/**
 * F6-B → R3-7:批次 —— 合约(pullInventoryLots)接上。
 * DTO 白名单:**无供应商字段位**(供应商归属是内部信息,类型上就进不来)。
 */
export default async function PortalLotsPage() {
  const session = await requirePortalPage();
  const lots = await portalLots(session);

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>批次</h1>
      {lots.state !== "ok" ? (
        <p data-testid="portal-lots-empty" style={{ color: "#888" }}>
          {lots.note} —— 接入后此处显示贵司批次;当前不显示任何示例数据。
        </p>
      ) : (
        <>
          {lots.note ? (
            <p style={{ color: "#888", fontSize: 12 }} data-testid="portal-lots-note">
              {lots.note}
            </p>
          ) : null}
          <table style={{ width: "100%", background: "#fff", borderRadius: 10, borderCollapse: "collapse", marginTop: 12 }} data-testid="portal-lots-table">
            <thead>
              <tr>
                {["批次", "物料编码", "数量", "仓库", "入库日期", "有效期至", "状态"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 13 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lots.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#888" }} data-testid="portal-lots-zero">
                    数据源正常,暂无归属贵司的批次记录
                  </td>
                </tr>
              ) : (
                lots.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.lotNo}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.materialCode}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.qty}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.warehouse ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.receivedAt ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.expiresAt ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.status ? STATUS_LABEL[r.status] ?? r.status : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
            数据更新时间:{lots.fetchedAt?.slice(0, 19).replace("T", " ")} —— 非实时。
          </p>
        </>
      )}
    </div>
  );
}
