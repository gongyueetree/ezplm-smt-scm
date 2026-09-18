/**
 * REF-2b:列词表是数据 —— 登记、审计与 BOM 口径。
 *
 * 词表的**快照**是 `CROSS_VOCABULARY_DIVERGENCES[*].uses` 与各词表的 `ambiguous`:
 * 改任何别名,只要改变了某个列名在任一词表里的归属,这里就会失败。
 */
import { describe, expect, it } from "vitest";
import { ALL_VOCABULARIES } from "@/modules/tabular/vocabularies";
import { CROSS_VOCABULARY_DIVERGENCES } from "@/modules/tabular/vocabularies/cross-vocabulary";
import {
  crossVocabularyDivergences,
  withinVocabularyCollisions,
} from "@/modules/tabular/domain/vocabulary-audit";
import { normalizeHeader } from "@/modules/tabular/domain/column-mapping";
import {
  detectColumnMapping,
  missingRecommendedFields,
} from "@/lib/domain/bom-parse";

describe("登记处", () => {
  it("id 唯一", () => {
    const ids = ALL_VOCABULARIES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个必需字段都有别名;没有空别名", () => {
    for (const v of ALL_VOCABULARIES) {
      const fields = Object.keys(v.aliases);
      for (const r of v.required) expect(fields, `${v.id}.${r}`).toContain(r);
      for (const [f, as] of Object.entries(v.aliases) as [string, readonly string[]][]) {
        expect(as.length, `${v.id}.${f}`).toBeGreaterThan(0);
        for (const a of as) expect(normalizeHeader(a), `${v.id}.${f}: ${JSON.stringify(a)}`).not.toBe("");
      }
    }
  });

  it("限定词规则引用的字段都存在", () => {
    for (const v of ALL_VOCABULARIES) {
      for (const q of v.qualified ?? []) {
        for (const f of [...q.of, q.field]) expect(Object.keys(v.aliases), `${v.id}`).toContain(f);
      }
    }
  });
});

describe("审计:同表重名必须登记含义", () => {
  it("每个词表的归一后重名 ≡ 其 ambiguous 登记", () => {
    for (const v of ALL_VOCABULARIES) {
      expect(Object.keys(withinVocabularyCollisions(v)).sort(), v.id).toEqual(
        Object.keys(v.ambiguous ?? {}).sort(),
      );
    }
  });
});

describe("审计:跨表异义必须登记理由(快照)", () => {
  it("算出的异义 ≡ 登记表(列名与各表归属逐项一致)", () => {
    const computed = crossVocabularyDivergences(ALL_VOCABULARIES);
    const declared = Object.fromEntries(
      Object.entries(CROSS_VOCABULARY_DIVERGENCES).map(([k, d]) => [normalizeHeader(k), [...d.uses].sort()]),
    );
    expect(computed).toEqual(declared);
  });

  it("每条都有理由;待客户确认的恰好是「料号」「物料编码」两条", () => {
    for (const [k, d] of Object.entries(CROSS_VOCABULARY_DIVERGENCES)) expect(d.reason.length, k).toBeGreaterThan(5);
    const pending = Object.entries(CROSS_VOCABULARY_DIVERGENCES)
      .filter(([, d]) => d.status === "PENDING_CUSTOMER")
      .map(([k]) => k);
    expect(pending.sort()).toEqual(["料号", "物料编码"].sort());
  });
});

describe("BOM 口径", () => {
  const fieldsOf = (header: string[]) => detectColumnMapping([header]).fields;

  it("**客户料号不被 MPN 抢走**(REF-2b 前 `Customer Part No` 归 MPN)", () => {
    for (const h of ["Customer Part No", "Customer Part #", "Cust Part Number", "客户型号", "客户物料号", "Customer P/N"]) {
      const f = fieldsOf([h, "Qty"]);
      expect(f.customerPn, h).toBe(0);
      expect(f.mpn, h).toBeUndefined();
    }
  });

  it("客户料号与 MPN 并存时各归其位", () => {
    expect(fieldsOf(["Customer Part No", "Manufacturer Part Number", "Qty"])).toMatchObject({
      customerPn: 0,
      mpn: 1,
      qty: 2,
    });
  });

  it("既有写法不变:`customer part number` 精确归客户料号,`Part Number` 归 MPN", () => {
    expect(fieldsOf(["Customer Part Number", "Part Number", "Qty"])).toMatchObject({ customerPn: 0, mpn: 1 });
  });

  it("「料号」单独出现 = **内部料号**(乾创口径),缺 MPN 如实提示而不是猜", () => {
    const m = detectColumnMapping([["料号", "数量"]]);
    expect(m.fields.internalPn).toBe(0);
    expect(m.fields.mpn).toBeUndefined();
    expect(missingRecommendedFields(m)).toEqual(["mpn"]);
  });

  it("「料号」与「型号」并存 → 内部料号 + MPN", () => {
    expect(fieldsOf(["料号", "型号", "数量"])).toMatchObject({ internalPn: 0, mpn: 1, qty: 2 });
  });

  it("`Part` 的登记行为:单独出现归 MPN;另有更强 MPN 列时归描述", () => {
    expect(fieldsOf(["Part", "Qty"]).mpn).toBe(0);
    expect(fieldsOf(["Part", "MPN", "Qty"])).toMatchObject({ description: 0, mpn: 1 });
  });
});
