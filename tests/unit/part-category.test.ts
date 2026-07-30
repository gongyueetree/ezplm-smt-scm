import { describe, expect, it } from "vitest";
import { CATEGORY_L1, isCategoryL1, suggestCategory } from "@/lib/domain/part-category";

describe("suggestCategory:只走精确映射,不猜", () => {
  it("整串命中", () => {
    expect(suggestCategory("微控制器")).toMatchObject({ l1: "IC", l2: "MCU" });
    expect(suggestCategory("电容")).toMatchObject({ l1: "阻容感", l2: "电容" });
  });

  it("ezPLM 常见写法:带括号说明与分段,按段精确命中", () => {
    // 详情页实测的分类串形如「微控制器(MCU)」
    expect(suggestCategory("微控制器(MCU)")).toMatchObject({ l1: "IC", l2: "MCU" });
    expect(suggestCategory("微控制器 - 32位 ARM")).toMatchObject({ l1: "IC", l2: "MCU" });
    expect(suggestCategory("电源管理/LDO")).toMatchObject({ l1: "IC" });
  });

  it("全角、大小写、空格与连字符差异都能归一", () => {
    expect(suggestCategory("ＭＣＵ")).toMatchObject({ l1: "IC", l2: "MCU" });
    expect(suggestCategory(" mosfet ")).toMatchObject({ l1: "分立器件", l2: "MOSFET" });
  });

  it("**映射不到就返回 null 并说明**,绝不模糊猜测", () => {
    const r = suggestCategory("某种没见过的分类");
    expect(r.l1).toBeNull();
    expect(r.l2).toBeNull();
    expect(r.reason).toContain("不做模糊猜测");
  });

  it("**不做子串匹配** —— 避免把不相关的分类蹭上", () => {
    // "非电容类附件" 含 "电容" 两字,但整段不等于"电容",不得命中
    expect(suggestCategory("非电容类附件").l1).toBeNull();
  });

  it("空值给出明确说明而不是默认分类", () => {
    expect(suggestCategory(null)).toMatchObject({ l1: null, matchedKey: null });
    expect(suggestCategory("")).toMatchObject({ l1: null });
    expect(suggestCategory(null).reason).toContain("需人工填写");
  });
});

describe("一级大类是封闭集合", () => {
  it("校验函数认已定义的、拒未定义的", () => {
    expect(isCategoryL1("IC")).toBe(true);
    expect(isCategoryL1("阻容感")).toBe(true);
    expect(isCategoryL1("随便写的")).toBe(false);
  });

  it("所有映射的 l1 都在封闭集合里", () => {
    for (const raw of ["微控制器", "电阻", "二极管", "连接器", "继电器"]) {
      const r = suggestCategory(raw);
      expect(CATEGORY_L1).toContain(r.l1!);
    }
  });
});
