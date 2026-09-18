/**
 * R4-2:Internal Material ↔ MFG 关系的领域规则(纯函数)。
 *
 * 三个身份层(§60):Internal PN(乾创)≠ Manufacturer/MPN(全球)≠ Customer PN(客户)。
 * Part.mpn 从 R4-2 起只是 preferred/compatibility 缓存(§6);真源是 PartMfgMapping。
 */
import type {
  MaterialKind,
  PartMfgIdentifierKind,
  PartMfgMappingSource,
  PartMfgMappingStatus,
  PartMfgMatchMode,
  PartMfgRelationType,
} from "@prisma/client";
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";
import { manufacturerKey } from "@/modules/parts/domain/manufacturer-registry";

/**
 * 匹配/去重键:upper + 只保留字母数字(**含 CJK**,\p{L}\p{N})。
 * 与迁移 SQL 的 regexp_replace(upper(x),'[^[:alnum:]]','','g') 一致。
 * 纯 ASCII 剥离会把「风华高科」这类中文厂商剥成空串 —— 必须保留 CJK。
 * 禁止用于展示。
 */
export function mfgPartNoKey(v: string | null | undefined): string {
  // REF-1b:规则本身不变(canonical 就是照这条选的),改为单一来源
  return normalizeMpnKey(v);
}

/**
 * 制造商去重键(空制造商 → 空串,唯一约束需要非 null)。
 *
 * REF-1c:转调 registry 的 `manufacturerKey`。规则与 `mfgPartNoKey` **完全相同**
 * (实测真实数据 2,959 个唯一厂商串零差异),但转调 registry 让**意图**明确:
 * 这是厂商键,不是 MPN 键,将来任一方要改规则时不会误伤另一方。
 *
 * @deprecated 请直接用 `manufacturerKey`;本函数保留为兼容层。
 */
export function manufacturerKeyOf(v: string | null | undefined): string {
  return manufacturerKey(v);
}

/**
 * §23:只有 APPROVED + PRIMARY + 人工确认(confirmedById 在场)才允许把映射
 * 同步回 Part.mpn/manufacturer 缓存。返回 null=允许,否则人话拒绝原因。
 */
export function whyCannotSyncPreferredMpn(m: {
  status: PartMfgMappingStatus;
  relationType: PartMfgRelationType;
  source: PartMfgMappingSource;
  confirmedById: string | null;
  identifierMatchMode: PartMfgMatchMode;
}): string | null {
  if (m.status !== "APPROVED") return "映射未 APPROVED,不得写 preferred MPN";
  if (m.relationType !== "PRIMARY") return "只有 PRIMARY 关系可作 preferred MPN";
  if (!m.confirmedById) return "缺少人工确认(confirmedById),不得写 preferred MPN";
  if (m.identifierMatchMode === "PATTERN") return "通配 MFG_PN(PATTERN)不得作 preferred MPN";
  return null;
}

/** §22:PO_HISTORY 证据的固定档位 —— 永远 CANDIDATE/HISTORICAL,禁止自动升级 */
export const PO_HISTORY_DEFAULTS = {
  source: "PO_HISTORY",
  relationType: "HISTORICAL",
  status: "CANDIDATE",
} as const satisfies Partial<{
  source: PartMfgMappingSource;
  relationType: PartMfgRelationType;
  status: PartMfgMappingStatus;
}>;

/**
 * §21:ERP MFG 维护单的默认档位 —— relationType=MAINTAINED;
 * status 是否直接 APPROVED 由租户配置决定,**默认保守 CANDIDATE**
 * (在客户确认「维护单=正式 AVL」语义前不假定)。
 */
export function mfgMaintenanceDefaults(tenantTreatsMaintenanceAsApproved: boolean): {
  source: PartMfgMappingSource;
  relationType: PartMfgRelationType;
  status: PartMfgMappingStatus;
} {
  return {
    source: "ERP_MFG_MAINTENANCE",
    relationType: "MAINTAINED",
    status: tenantTreatsMaintenanceAsApproved ? "APPROVED" : "CANDIDATE",
  };
}

/** §28:只有元器件标识才允许进 ezPLM/DigiKey/Mouser 元器件管线 */
export function allowsComponentProviders(kind: PartMfgIdentifierKind): boolean {
  return kind === "COMPONENT_MPN";
}

/** §28:MaterialKind 分流 —— PCB 裸板禁止元器件 API(生命周期/替代同禁) */
export function materialKindAllowsComponentProviders(kind: MaterialKind): boolean {
  return kind === "ELECTRONIC_COMPONENT";
}

/** PO_HISTORY candidate 的置信度上限(§27 v1/§48):不得达到批量确认线 */
export const PO_HISTORY_MAX_CONFIDENCE = 0.75;
