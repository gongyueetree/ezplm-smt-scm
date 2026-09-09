import { portalMovements } from "@/lib/server/portal";
import { requirePortalPage } from "../require";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { IN: "入库", OUT: "出库", TRANSFER: "调拨", ADJUST: "调整" };

/**
 * F6-B → R3-7:出入流水 —— 合约(pullInventoryMovements)接上。
 * capability 语义:「数据源暂未接入」(NOT_CONFIGURED/NOT_IMPLEMENTED)与
 * 「0 条记录」(源正常但无归属贵司的行)界面上截然分开,不混淆。
 */
export default async function PortalTransactionsPage() {
  const session = await requirePortalPage();
  const mv = await portalMovements(session);

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>出入流水</h1>
      {mv.state !== "ok" ? (
        <p data-testid="portal-transactions-empty" style={{ color: "#888" }}>
          {mv.note} —— 接入后此处显示贵司相关记录;当前不显示任何示例数据。
        </p>
      ) : (
        <>
          {mv.note ? (
            <p style={{ color: "#888", fontSize: 12 }} data-testid="portal-transactions-note">
              {mv.note}
            </p>
          ) : null}
          <table style={{ width: "100%", background: "#fff", borderRadius: 10, borderCollapse: "collapse", marginTop: 12 }} data-testid="portal-transactions-table">
            <thead>
              <tr>
                {["时间", "类型", "物料编码", "数量", "仓库", "批次", "关联单据"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 13 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mv.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#888" }} data-testid="portal-transactions-zero">
                    数据源正常,暂无归属贵司的流水记录
                  </td>
                </tr>
              ) : (
                mv.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.occurredAt.slice(0, 16).replace("T", " ")}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{TYPE_LABEL[r.movementType] ?? r.movementType}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.materialCode}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.qty}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.warehouse ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.lotNo ?? "—"}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{r.refDocNo ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
            数据更新时间:{mv.fetchedAt?.slice(0, 19).replace("T", " ")} —— 非实时。
          </p>
        </>
      )}
    </div>
  );
}
