/** F1 · lib/metrics:OPO 域 KPI */
import { deriveOpoKpi } from "@/lib/domain/opo";
import { loadOpoLines } from "@/lib/server/repositories/opo";

export async function opoMetric(tenantId: string, now: string) {
  return deriveOpoKpi(await loadOpoLines(tenantId), now);
}
