/**
 * R4-1:MaterialKind / IdentifierKind 分类(§7/§9/§11)。
 *
 * 分类优先级(审计实据,R4_REAL_DATA_AUDIT §3):
 * 1. ERP「料号类型」列 —— 一级证据(阻容感/IC/结构件/PCB/PCBA/标签…),confidence 1.0;
 * 2. 物料名称含 PCB —— 次级证据(注意 PCBA 干扰,先判 PCBA);
 * 3. MFG_PN 前缀(如 PCB-)—— 仅 strong secondary evidence,**不得单独定分类**(§11)。
 * 分类来源与置信度必须保留(classificationSource/confidence)。
 */
import type {
  IdentifierKind,
  IdentifierMatchMode,
  MaterialKind,
  MaterialKindSource,
} from "../canonical/types";

/** ERP 料号类型 → MaterialKind(乾创 K3 实测值;未知值 → OTHER 且降置信度) */
const ERP_TYPE_MAP: Record<string, MaterialKind> = {
  阻容感: "ELECTRONIC_COMPONENT",
  IC: "ELECTRONIC_COMPONENT",
  结构件: "MECHANICAL",
  五金器件: "MECHANICAL",
  PCB: "PCB_BARE_BOARD",
  PCBA: "ASSEMBLY",
  标签: "CONSUMABLE",
  包材: "CONSUMABLE",
  线材: "CABLE",
  物品: "OTHER",
  其他: "OTHER",
};

export interface MaterialKindResult {
  materialKind: MaterialKind;
  source: MaterialKindSource;
  confidence: number;
}

export function classifyMaterialKind(input: {
  rawMaterialType?: string | null;
  materialName?: string | null;
}): MaterialKindResult {
  const t = input.rawMaterialType?.trim();
  if (t && ERP_TYPE_MAP[t]) {
    return { materialKind: ERP_TYPE_MAP[t], source: "ERP_MATERIAL_TYPE", confidence: 1.0 };
  }
  if (t) {
    // 未知的 ERP 类型值:如实 OTHER,低置信度 —— 不猜映射(新值出现时人工扩表)
    return { materialKind: "OTHER", source: "ERP_MATERIAL_TYPE", confidence: 0.5 };
  }
  const name = (input.materialName ?? "").toUpperCase();
  if (name) {
    // 先判 PCBA(含 PCB 子串,裸 includes 会误判 —— 外部字段解析纪律)
    if (/\bPCBA\b|PCBA/.test(name)) {
      return { materialKind: "ASSEMBLY", source: "ERP_MATERIAL_NAME", confidence: 0.8 };
    }
    if (/\bPCB\b|PCB板|PCB/.test(name)) {
      return { materialKind: "PCB_BARE_BOARD", source: "ERP_MATERIAL_NAME", confidence: 0.8 };
    }
  }
  return { materialKind: "OTHER", source: "ERP_MATERIAL_NAME", confidence: 0.3 };
}

/** MaterialKind → 该物料外部标识的 IdentifierKind(§9) */
export function identifierKindFor(kind: MaterialKind): IdentifierKind {
  switch (kind) {
    case "ELECTRONIC_COMPONENT":
      return "COMPONENT_MPN";
    case "PCB_BARE_BOARD":
      return "PCB_PART_NO";
    case "MECHANICAL":
      return "MECHANICAL_PART_NO";
    case "ASSEMBLY":
      return "ASSEMBLY_PART_NO";
    case "CABLE":
    case "CONSUMABLE":
    case "OTHER":
      return "OTHER";
  }
}

/**
 * MFG_PN 匹配模式(§10):含 * → PATTERN(只可做候选/搜索提示,禁止 exact API 查询
 * 与自动确认);空/垃圾 → UNKNOWN;其余 EXACT。
 */
export function identifierMatchModeOf(mfgPn: string | null | undefined): IdentifierMatchMode {
  const t = mfgPn?.trim();
  if (!t) return "UNKNOWN";
  if (t.includes("*")) return "PATTERN";
  return "EXACT";
}
