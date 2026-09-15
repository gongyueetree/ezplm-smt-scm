/**
 * R4-3(§15/§16):ManufacturerResolver —— 正式制造商身份解析(纯函数核心)。
 *
 * 解析顺序(确定性从高到低,§16):
 *   1 TENANT_ALIAS  (乾创:YAGEO(国巨)→YAGEO)          conf 1.00
 *   2 GLOBAL_ALIAS  (行业:TI→Texas Instruments)          conf 1.00
 *   3 CANONICAL_EXACT(归一后与标准名精确相等)             conf 1.00
 *   4 MPN_EVIDENCE  (exact MPN → 唯一 ezPLM 件 → 厂商)    conf ≈0.98,**候选不落永久别名**(§20)
 *   5 FUZZY_CANDIDATE(词级相似)                           conf ≤0.70,只可候选
 *   6 UNRESOLVED
 *
 * 冲突(§18):MPN 证据厂商与 raw 不相容 → MANUFACTURER_CONFLICT,
 * requiresManualDecision,不覆盖任何一方。
 * §20:existing alias / canonical exact 才可直接确定;fuzzy/MPN 证据永远是候选;
 * 本模块为纯函数 —— 不写库,别名落库只能走人工批准流程(review 仓储)。
 *
 * 保留低层 manufacturerMatches() 作 provider fallback(§15),此处不复用其
 * 前缀启发做"确定"判定,只用于 MPN 证据相容性检查与 fuzzy 候选。
 */
import { manufacturerAliases, manufacturerMatches } from "@/lib/providers/common/mpn";
import { manufacturerKeyOf } from "@/lib/domain/part-mfg";
import type { MaterialKind } from "../canonical/types";

export interface CanonicalManufacturerLite {
  id: string;
  canonicalName: string;
  normalizedName: string;
}

export interface AliasLite {
  normalizedAlias: string;
  canonicalRefId: string;
  canonicalName: string;
}

export type ManufacturerResolutionType =
  | "TENANT_ALIAS"
  | "GLOBAL_ALIAS"
  | "CANONICAL_EXACT"
  | "MPN_EVIDENCE"
  | "FUZZY_CANDIDATE"
  | "MANUFACTURER_CONFLICT"
  | "UNRESOLVED";

export interface ManufacturerResolution {
  rawManufacturer: string | null;
  canonicalManufacturerId: string | null;
  canonicalManufacturerName: string | null;
  resolution: ManufacturerResolutionType;
  confidence: number;
  /** 人话证据链(展示/审计用;不含整行源数据) */
  evidence: string[];
  requiresManualDecision: boolean;
}

export interface ResolverContext {
  /** 当前租户的 APPROVED 别名(normalizedAlias → ref);禁止混入其它租户(§14) */
  tenantAliases: Map<string, AliasLite>;
  /** GLOBAL APPROVED 别名 */
  globalAliases: Map<string, AliasLite>;
  /** normalizedName → canonical */
  canonicalByNorm: Map<string, CanonicalManufacturerLite>;
  /**
   * exact MPN 证据查询(注入;实现走**本地 ezPLM 缓存**,不打线上 API):
   * 归一 MPN → 唯一命中的制造商名;多义/未命中 → null
   */
  mpnEvidence?: (normalizedMpn: string) => { manufacturerName: string } | null;
}

const junk = /^(#N\/?A?|N\/?A|NA|0|-+|无|\/|—)$/i;

export function resolveManufacturer(
  input: {
    rawManufacturer: string | null | undefined;
    mpn?: string | null;
    materialKind?: MaterialKind;
  },
  ctx: ResolverContext,
): ManufacturerResolution {
  const raw = input.rawManufacturer?.trim() || null;
  const base: Omit<ManufacturerResolution, "resolution" | "confidence"> = {
    rawManufacturer: raw,
    canonicalManufacturerId: null,
    canonicalManufacturerName: null,
    evidence: [],
    requiresManualDecision: false,
  };

  // §28:PCB/非元器件不进元器件制造商解析(PCB 的 MFG 可能是板厂)
  if (input.materialKind && input.materialKind !== "ELECTRONIC_COMPONENT") {
    return {
      ...base,
      resolution: "UNRESOLVED",
      confidence: 0,
      evidence: [`materialKind=${input.materialKind}:不进入元器件制造商解析`],
    };
  }

  const rawKey = raw && !junk.test(raw) ? manufacturerKeyOf(raw) : "";
  const mpnKey = manufacturerKeyOf(input.mpn ?? "");

  // MPN 证据先算出来(§17:MPN 帮助校验 Manufacturer,而不是反过来)
  const mpnHit = mpnKey && ctx.mpnEvidence ? ctx.mpnEvidence(mpnKey) : null;

  if (rawKey) {
    // L1 租户别名
    const t = ctx.tenantAliases.get(rawKey);
    if (t) {
      return withConflictCheck(
        {
          ...base,
          canonicalManufacturerId: t.canonicalRefId,
          canonicalManufacturerName: t.canonicalName,
          resolution: "TENANT_ALIAS",
          confidence: 1.0,
          evidence: [`租户别名:「${raw}」→ ${t.canonicalName}`],
        },
        mpnHit,
      );
    }
    // L2 全局别名
    const g = ctx.globalAliases.get(rawKey);
    if (g) {
      return withConflictCheck(
        {
          ...base,
          canonicalManufacturerId: g.canonicalRefId,
          canonicalManufacturerName: g.canonicalName,
          resolution: "GLOBAL_ALIAS",
          confidence: 1.0,
          evidence: [`全局别名:「${raw}」→ ${g.canonicalName}`],
        },
        mpnHit,
      );
    }
    // L3 标准名精确
    const c = ctx.canonicalByNorm.get(rawKey);
    if (c) {
      return withConflictCheck(
        {
          ...base,
          canonicalManufacturerId: c.id,
          canonicalManufacturerName: c.canonicalName,
          resolution: "CANONICAL_EXACT",
          confidence: 1.0,
          evidence: [`标准名精确命中:${c.canonicalName}`],
        },
        mpnHit,
      );
    }
  }

  // L4 MPN 证据(高置信候选,不自动落别名 §20)
  if (mpnHit) {
    const evCanonical = findCanonicalByName(ctx, mpnHit.manufacturerName);
    // §18:raw 与证据厂商不相容 → 冲突,人工决
    if (raw && !junk.test(raw) && !manufacturerMatches(mpnHit.manufacturerName, raw)) {
      return {
        ...base,
        resolution: "MANUFACTURER_CONFLICT",
        confidence: 0,
        requiresManualDecision: true,
        evidence: [
          `MPN 证据指向 ${mpnHit.manufacturerName},与原始厂商「${raw}」不相容 —— 不覆盖任何一方,人工裁决`,
        ],
      };
    }
    return {
      ...base,
      canonicalManufacturerId: evCanonical?.id ?? null,
      canonicalManufacturerName: evCanonical?.canonicalName ?? mpnHit.manufacturerName,
      resolution: "MPN_EVIDENCE",
      confidence: 0.98,
      requiresManualDecision: true, // 高置信候选,批准后才生成租户别名(§16 L4)
      evidence: [`exact MPN 唯一命中 ezPLM 缓存 → 厂商 ${mpnHit.manufacturerName}`],
    };
  }

  // L5 fuzzy(词级相似;只可候选,禁止自动确认 §16 L5)
  if (rawKey && raw) {
    for (const c of ctx.canonicalByNorm.values()) {
      if (manufacturerAliases(raw).some((a) => manufacturerMatches(c.canonicalName, a))) {
        return {
          ...base,
          canonicalManufacturerId: c.id,
          canonicalManufacturerName: c.canonicalName,
          resolution: "FUZZY_CANDIDATE",
          confidence: 0.6,
          requiresManualDecision: true,
          evidence: [`名称相似候选:「${raw}」≈ ${c.canonicalName}(仅候选,需人工确认)`],
        };
      }
    }
  }

  return {
    ...base,
    resolution: "UNRESOLVED",
    confidence: 0,
    evidence: raw ? [`「${raw}」无别名/标准名/证据命中`] : ["原始厂商为空或垃圾占位"],
  };
}

/** 确定性命中后仍用 MPN 证据做相容性复核(§18):不相容 → 降级为冲突 */
function withConflictCheck(
  r: ManufacturerResolution,
  mpnHit: { manufacturerName: string } | null,
): ManufacturerResolution {
  if (
    mpnHit &&
    r.canonicalManufacturerName &&
    !manufacturerMatches(mpnHit.manufacturerName, r.canonicalManufacturerName)
  ) {
    return {
      ...r,
      canonicalManufacturerId: null,
      canonicalManufacturerName: null,
      resolution: "MANUFACTURER_CONFLICT",
      confidence: 0,
      requiresManualDecision: true,
      evidence: [
        ...r.evidence,
        `但 exact MPN 证据指向 ${mpnHit.manufacturerName} —— 与解析结果冲突,人工裁决`,
      ],
    };
  }
  return r;
}

function findCanonicalByName(
  ctx: ResolverContext,
  name: string,
): CanonicalManufacturerLite | null {
  const k = manufacturerKeyOf(name);
  const direct = ctx.canonicalByNorm.get(k);
  if (direct) return direct;
  const viaGlobal = ctx.globalAliases.get(k);
  if (viaGlobal) {
    return {
      id: viaGlobal.canonicalRefId,
      canonicalName: viaGlobal.canonicalName,
      normalizedName: manufacturerKeyOf(viaGlobal.canonicalName),
    };
  }
  return null;
}
