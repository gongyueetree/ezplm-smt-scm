import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { ModulePlaceholder } from "@/components/ui/module-placeholder";
import { ezplmProviderMode } from "@/lib/providers/ezplm";
import { digiKeyMode } from "@/lib/providers/digikey";
import { mouserMode } from "@/lib/providers/mouser";

/**
 * 物料查询占位页 + 三方数据源状态(PR3/PR4)。
 * 诚实 UI 纪律:只区分「示例数据(Mock)/ 已配置凭据 · 待联调验证」,
 * 在冒烟脚本跑通并留痕之前,不出现任何"已联调/已接通"表述。
 */
const SOURCES = [
  {
    key: "ezPLM",
    scope: "物料主数据 · 库存 · 在途 · 客户料号映射(只读真源)",
    mode: ezplmProviderMode,
    pr: "PR3",
  },
  {
    key: "DigiKey",
    scope: "Product Information V4 · 正式价格与库存 / 关键字候选 / 替代料",
    mode: digiKeyMode,
    pr: "PR4",
  },
  {
    key: "Mouser",
    scope: "Search API v1 · 正式价格与库存 / 关键字候选(限流 + 日配额)",
    mode: mouserMode,
    pr: "PR4",
  },
] as const;

export default function MaterialsPage() {
  const rows = SOURCES.map((s) => ({ ...s, mode: s.mode() }));
  const anyHttp = rows.some((r) => r.mode === "http");

  return (
    <div>
      <ModulePlaceholder path="/materials" />
      <Card title="外部数据源状态" sub="PR3 / PR4 · Provider 层">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>数据源</th>
                <th>当前形态</th>
                <th>覆盖范围</th>
                <th>交付 PR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <b>{r.key}</b>
                  </td>
                  <td>
                    {r.mode === "mock" ? (
                      <Badge tone="amber">示例数据 · 未配置凭据</Badge>
                    ) : (
                      <Badge tone="blue">已配置凭据 · 待联调验证</Badge>
                    )}
                  </td>
                  <td className="small muted">{r.scope}</td>
                  <td className="small muted">{r.pr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divider" />
        <Banner tone="soft">
          <span>
            Provider 层(接口 / Mock / Http / 鉴权 / 限流 / 熔断重试 / 缓存键 / 合同测试)已交付。
            {anyHttp
              ? "部分数据源已配置凭据,但真实环境联调需运行 pnpm smoke:external 并留存输出后才算完成 —— 在此之前本页不声称已联调。"
              : "当前全部为示例数据:比价、候选与库存均来自本地样例,不代表真实供应商行情。"}
            价格、GTB、Markup、PPV 等数值一律由确定性 TypeScript 函数计算;排名仅为建议,正式供应商选择必须人工确认。
          </span>
        </Banner>
      </Card>
    </div>
  );
}
