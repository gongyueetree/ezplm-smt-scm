/**
 * closed-loop P0-6:ERP Lab 作为**测试专用**主数据源。
 *
 * 目的:BOM → 内部料号 → Lab 物料 → 库存 → Excess → PO 的完整测试链,
 * 在不触碰金蝶的前提下闭环。UI 一律显示「ERP 仿真主数据」,
 * **严禁显示为金蝶/正式主数据已连接**。
 *
 * 能力边界(如实):
 * - searchParts:Lab 无关键字检索 —— 逐页拉取(封顶 SEARCH_SCAN_CAP)后本地按
 *   materialCode/mpn/描述 包含匹配;超过封顶如实截断,不假装全库搜过;
 * - 替代/合规/参数/文档:Lab **没有这些数据集** —— 返回空集是事实,不是"查过没有"
 *   的伪装(与金蝶 NotImplemented 语义不同:这里的数据源真实存在且为空)。
 */
import type {
  BatchResolveInput,
  BatchResolveResult,
  CanonicalPart,
  InventoryResult,
  SearchPartsInput,
} from "@/lib/providers/ezplm/types";
import type { EzplmPartsProvider } from "@/lib/providers/ezplm/provider";
import type { ErpMaterial, ErpProvider } from "@/lib/providers/erp/types";

const LAB_CONFIG = { vendor: "ERP_LAB", config: {}, secrets: {} };
const SEARCH_SCAN_CAP = 1000;

function toCanonical(m: ErpMaterial): CanonicalPart {
  return {
    id: m.externalId,
    internalPn: m.internalPn,
    mpn: m.mpn,
    manufacturer: m.manufacturer,
    description: m.description,
    footprint: m.footprint,
    category: null,
    lifecycle: (["ACTIVE", "NRND", "EOL", "OBSOLETE"].includes(m.lifecycle ?? "")
      ? m.lifecycle
      : "UNKNOWN") as CanonicalPart["lifecycle"],
    rohs: null,
    reach: null,
    msl: null,
    packaging: null,
    dateCode: null,
    updatedAt: m.updatedAt ?? new Date(0).toISOString(),
  };
}

const norm = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export function createErpLabMasterDataAdapter(lab: ErpProvider): EzplmPartsProvider {
  async function scanMaterials(matcher: (m: ErpMaterial) => boolean, cap: number): Promise<ErpMaterial[]> {
    const hits: ErpMaterial[] = [];
    let cursor: string | null = null;
    let scanned = 0;
    for (;;) {
      const page = await lab.pullMaterials(LAB_CONFIG, { cursor, limit: 200 });
      for (const m of page.items) {
        scanned += 1;
        if (matcher(m)) hits.push(m);
      }
      if (!page.page.hasMore || scanned >= cap) break;
      cursor = page.page.cursor;
    }
    return hits;
  }

  return {
    async searchParts(input: SearchPartsInput): Promise<CanonicalPart[]> {
      const kw = input.keyword.toUpperCase();
      const hits = await scanMaterials(
        (m) =>
          (m.mpn ?? "").toUpperCase().includes(kw) ||
          (m.internalPn ?? "").toUpperCase().includes(kw) ||
          (m.description ?? "").toUpperCase().includes(kw),
        SEARCH_SCAN_CAP,
      );
      return hits.slice(0, input.limit ?? 20).map(toCanonical);
    },

    async getPartByMpn(input): Promise<CanonicalPart | null> {
      // 先用服务端 materialCode 过滤(命中最快),再退回 mpn 扫描
      const byCode = await lab.pullMaterials(LAB_CONFIG, { materialCode: input.mpn, limit: 1 });
      if (byCode.items[0]) return toCanonical(byCode.items[0]);
      const target = norm(input.mpn);
      const hits = await scanMaterials((m) => norm(m.mpn) === target || norm(m.internalPn) === target, SEARCH_SCAN_CAP);
      return hits[0] ? toCanonical(hits[0]) : null;
    },

    async batchResolve(inputs: BatchResolveInput[]): Promise<BatchResolveResult[]> {
      const out: BatchResolveResult[] = [];
      for (const query of inputs) {
        const key = query.mpn ?? query.internalPn ?? query.customerPn ?? "";
        const part = key ? await this.getPartByMpn({ mpn: key }) : null;
        out.push({ query, part, confidence: part ? 0.9 : 0 });
      }
      return out;
    },

    async getInventory(partIds: string[]): Promise<InventoryResult[]> {
      const out: InventoryResult[] = [];
      for (const partId of partIds) {
        // partId = Lab material externalId;先取物料得 materialCode,再按 materialCode 查库存
        const mat = await lab.pullMaterials(LAB_CONFIG, { limit: 200 });
        const material = mat.items.find((m) => m.externalId === partId);
        if (!material?.internalPn && !material) continue;
        const inv = await lab.pullInventory(LAB_CONFIG, {
          materialCode: material?.internalPn ?? undefined,
          limit: 200,
        });
        const qty = inv.items.reduce((n, r) => n + Number(r.qty), 0);
        out.push({
          partId,
          qtyOnHand: qty,
          qtySlowMoving: null,
          warehouse: inv.items[0]?.warehouse ?? null,
          updatedAt: new Date().toISOString(),
        });
      }
      return out;
    },

    // Lab 没有以下数据集 —— 空集是事实(数据源在线且为空),UI 已标「ERP 仿真主数据」
    async getCustomerMappings() {
      return [];
    },
    async getAlternates() {
      return [];
    },
    async getCompliance(partId: string) {
      return { partId, rohs: null, reach: null, notes: "ERP 仿真主数据无合规数据集", updatedAt: new Date().toISOString() };
    },
    async getParameters() {
      return [];
    },
    async searchPartsWithParameters(input) {
      const parts = await this.searchParts(input);
      return parts.map((part) => ({ part, parameters: [] }));
    },
    async getDocuments() {
      return [];
    },
  };
}
