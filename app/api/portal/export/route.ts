import { toCsv } from "@/lib/domain/csv";
import { portalInventory, requirePortalSession } from "@/lib/server/portal";

export const runtime = "nodejs";

/** F6-B:导出(白名单字段,customer scope) */
export async function GET() {
  const auth = await requirePortalSession();
  if (!auth.ok) return auth.response;
  const inv = await portalInventory(auth.session);
  const csv = toCsv(
    ["物料编码", "数量", "仓库", "批次", "数据更新时间"],
    inv.rows.map((r) => [r.materialCode, r.qty, r.warehouse ?? "", r.lotNo ?? "", r.updatedAt ?? ""]),
  );
  const note = inv.state !== "ok" ? `# ${inv.note}\n` : "";
  return new Response("﻿" + note + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="my-inventory.csv"',
    },
  });
}
