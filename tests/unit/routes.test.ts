import { describe, expect, it } from "vitest";
import {
  NAV_SECTIONS,
  backTarget,
  breadcrumbFor,
  findRoute,
  flattenRoutes,
  parentPath,
  unimplementedRoutes,
} from "@/lib/routes";

/** SPEC §2 要求的 15 条基础路由 */
const SPEC_ROUTES = [
  "/",
  "/rfq",
  "/bom",
  "/bom/import",
  "/bom/compare",
  "/materials",
  "/quotes",
  "/procurement/rfq",
  "/procurement/orders",
  "/suppliers/opo",
  "/reconciliation",
  "/shortage",
  "/kitting",
  "/inventory",
  "/settings",
];

describe("统一 route config(SPEC §2)", () => {
  it("包含 SPEC 路由清单的全部 15 条路由", () => {
    const paths = flattenRoutes().map((r) => r.path);
    for (const p of SPEC_ROUTES) {
      expect(paths, `缺少路由 ${p}`).toContain(p);
    }
  });

  it("路由路径唯一,且全部以 / 开头", () => {
    const paths = flattenRoutes().map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
  });

  it("每条路由都有 label、desc 与 plannedPr(诚实占位标注)", () => {
    for (const r of flattenRoutes()) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.desc.length).toBeGreaterThan(0);
      // PR1–PR9 是 SPEC §19 的原始批次;之后追加的能力用字母编号(PR-A/PR-B/PR-C);
      // Round2 起按 KICKOFF_ROUND2.md 用 F 批次(F1–F7);Round3 起按 ROUND3_AUDIT 用 R3-N。
      // 都算合法的"落地计划",不允许留空
      expect(r.plannedPr).toMatch(/^(PR(\d|-[A-Z])|F\d|R3-\d)/);
    }
  });

  it("菜单 section 标题非空且不重复", () => {
    const titles = NAV_SECTIONS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("findRoute / parentPath / breadcrumbFor", () => {
  it("findRoute 精确匹配并容忍尾部斜杠", () => {
    expect(findRoute("/bom/import")?.label).toBe("BOM 导入");
    expect(findRoute("/bom/import/")?.label).toBe("BOM 导入");
    expect(findRoute("/")?.path).toBe("/");
    expect(findRoute("/nonexistent")).toBeUndefined();
  });

  it("parentPath:子页面返回上一层,顶级返回根,根返回 null", () => {
    expect(parentPath("/bom/import")).toBe("/bom");
    expect(parentPath("/procurement/rfq")).toBe("/procurement");
    expect(parentPath("/rfq")).toBe("/");
    expect(parentPath("/")).toBeNull();
  });

  it("所有非根路由均可解析出返回目标(SPEC §2:子页面必须有返回上一层)", () => {
    for (const r of flattenRoutes()) {
      if (r.path === "/") continue;
      expect(backTarget(r.path), `路由 ${r.path} 无返回目标`).not.toBeNull();
    }
  });

  it("backTarget 指向最近的已配置路由,不指向未配置路径", () => {
    // /bom/import 的上一层 /bom 已配置
    expect(backTarget("/bom/import")?.path).toBe("/bom");
    // /procurement/rfq 的上一层 /procurement 未配置页面,应回退到根
    expect(backTarget("/procurement/rfq")?.path).toBe("/");
    expect(backTarget("/suppliers/opo")?.path).toBe("/");
    expect(backTarget("/")).toBeNull();
  });

  it("breadcrumbFor 从根开始并终于当前路由", () => {
    const crumbs = breadcrumbFor("/bom/import");
    expect(crumbs[0].path).toBe("/");
    expect(crumbs[crumbs.length - 1].path).toBe("/bom/import");
    expect(crumbs.map((c) => c.path)).toEqual(["/", "/bom", "/bom/import"]);
  });
});

describe("implemented 标记与实际页面一致(防配置与代码脱节)", () => {
  it("未实现路由的集合与仍在用 ModulePlaceholder 的页面一一对应", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const appDir = path.resolve(__dirname, "../../app/(app)");

    /** 递归找出所有 page.tsx 里引用了 ModulePlaceholder 的路由路径 */
    const placeholderPaths: string[] = [];
    const walk = (dir: string, segments: string[]) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), [...segments, entry.name]);
        } else if (entry.name === "page.tsx") {
          const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
          if (src.includes("ModulePlaceholder")) {
            placeholderPaths.push("/" + segments.join("/"));
          }
        }
      }
    };
    walk(appDir, []);

    const configured = unimplementedRoutes()
      .map((r) => r.path)
      .sort();
    expect(placeholderPaths.sort()).toEqual(configured);
  });

  it("未实现路由都带 plannedPr,便于占位页如实告知落地计划", () => {
    for (const r of unimplementedRoutes()) {
      // PR1–PR9 是 SPEC §19 的原始批次;之后追加的能力用字母编号(PR-A/PR-B/PR-C);
      // Round2 起按 KICKOFF_ROUND2.md 用 F 批次(F1–F7)。都算合法的"落地计划",不允许留空
      expect(r.plannedPr).toMatch(/^(PR(\d|-[A-Z])|F\d)/);
    }
  });
});
