/**
 * R3-6:Lab 数据集就绪度客户端(只读展示,不在主仓复制 Simulator)。
 *
 * 供集成状态页回答:客户脱敏快照导入 Lab 之后,主仓这边**看得见什么**——
 * 数据集名/版本/种子时间/场景/各实体行数/映射档案数,加健康检查延迟。
 * 口径如实:这是「Lab 数据集的现状」,不是金蝶;导入对账报告(断裂引用等)
 * 在 Lab 导入界面呈现且未持久化,这里不假装能拿到。
 */
import { resolveErpLabEnv } from "@/lib/providers/erp/lab";

export interface LabDatasetSummary {
  state: "ok" | "not_configured" | "error";
  /** 未配置/失败的人话原因 */
  note: string | null;
  health: { ok: boolean; version: string | null; latencyMs: number | null } | null;
  dataset: {
    datasetName: string;
    tenantId: string;
    version: number;
    seededAt: string;
    scenario: string;
    counts: Record<string, number>;
    mappingProfiles: number;
  } | null;
  /** Lab 界面地址(快照上传/场景注入在 Lab 侧操作) */
  labUrl: string | null;
}

const TIMEOUT_MS = 10_000;

async function get(url: string, token?: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Lab 返回 HTTP ${res.status}`);
  return res.json();
}

export async function fetchLabDatasetSummary(labTenantId?: string | null): Promise<LabDatasetSummary> {
  const env = resolveErpLabEnv(labTenantId);
  if (!env) {
    return {
      state: "not_configured",
      note: "ERP_LAB_BASE_URL / ERP_LAB_ACCESS_TOKEN 未配置 —— 数据集状态待接入",
      health: null,
      dataset: null,
      labUrl: null,
    };
  }
  try {
    const [healthRaw, datasetRaw] = await Promise.all([
      get(`${env.baseUrl}/api/health`),
      get(`${env.baseUrl}/api/erp?tenantId=${encodeURIComponent(env.tenantId)}`, env.accessToken),
    ]);
    const health = healthRaw as { ok?: boolean; version?: string; latencyMs?: number };
    const ds = (datasetRaw as { data?: Record<string, unknown> }).data;
    if (!ds || typeof ds !== "object") throw new Error("Lab 数据集响应形状不符");
    const countOf = (k: string) => (Array.isArray(ds[k]) ? (ds[k] as unknown[]).length : 0);
    const scenario = ds.scenario as { scenario?: string } | undefined;
    return {
      state: "ok",
      note: null,
      health: {
        ok: health.ok === true,
        version: health.version ?? null,
        latencyMs: typeof health.latencyMs === "number" ? health.latencyMs : null,
      },
      dataset: {
        datasetName: String(ds.datasetName ?? "?"),
        tenantId: String(ds.tenantId ?? env.tenantId),
        version: Number(ds.version ?? 0),
        seededAt: String(ds.seededAt ?? ""),
        scenario: scenario?.scenario ?? "NORMAL",
        counts: {
          物料: countOf("materials"),
          库存: countOf("inventory"),
          呆滞: countOf("excess"),
          供应商: countOf("suppliers"),
          客户: countOf("customers"),
          汇率: countOf("exchangeRates"),
          采购订单: countOf("purchaseOrders"),
          收货单: countOf("receipts"),
          工单: countOf("workOrders"),
          销售订单: countOf("salesOrders"),
        },
        mappingProfiles: countOf("mappingProfiles"),
      },
      labUrl: env.baseUrl,
    };
  } catch (e) {
    return {
      state: "error",
      note: `Lab 数据集读取失败:${e instanceof Error ? e.message : "未知错误"}`,
      health: null,
      dataset: null,
      labUrl: env.baseUrl,
    };
  }
}
