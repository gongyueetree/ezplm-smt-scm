import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { ezplmProviderMode } from "@/lib/providers/ezplm";
import { digiKeyMode } from "@/lib/providers/digikey";
import { mouserMode } from "@/lib/providers/mouser";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const dynamic = "force-dynamic";

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
    /** 联调记录:null = 尚未与真实环境联调 */
    verified: null,
  },
  {
    key: "DigiKey",
    scope: "Product Information V4 · 正式价格与库存 / 关键字候选 / 替代料",
    mode: digiKeyMode,
    pr: "PR4",
    verified: "2026-07-27 冒烟联调通过",
  },
  {
    key: "Mouser",
    scope: "Search API v1 · 正式价格与库存 / 关键字候选(限流 + 日配额)",
    mode: mouserMode,
    pr: "PR4",
    verified: "2026-07-27 冒烟联调通过",
  },
] as const;

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = (await getSession())!;
  const keyword = (q ?? "").trim();

  const parts = await prisma.part.findMany({
    where: tenantWhere(
      session.tenantId,
      keyword
        ? {
            OR: [
              { mpn: { contains: keyword, mode: "insensitive" as const } },
              { internalPn: { contains: keyword, mode: "insensitive" as const } },
              { manufacturer: { contains: keyword, mode: "insensitive" as const } },
              { description: { contains: keyword, mode: "insensitive" as const } },
            ],
          }
        : {},
    ),
    orderBy: { internalPn: "asc" },
    take: 100,
  });

  const snapshots = parts.length
    ? await prisma.inventorySnapshot.findMany({
        where: tenantWhere(session.tenantId, { partId: { in: parts.map((p) => p.id) } }),
        orderBy: { fetchedAt: "desc" },
      })
    : [];
  const latestByPart = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) if (!latestByPart.has(s.partId)) latestByPart.set(s.partId, s);

  const rows = SOURCES.map((s) => ({ ...s, mode: s.mode() }));
  const anyHttp = rows.some((r) => r.mode === "http");

  return (
    <div>
      <PageHeader path="/materials" />

      <Card title="物料查询" sub="ezPLM 只读缓存;显示缓存时点,不代表实时">
        <form method="get" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
            <span>关键字(MPN / 内部料号 / 制造商 / 描述)</span>
            <input name="q" defaultValue={keyword} placeholder="如 STM32 / 0603 / Murata" />
          </label>
          <button className="btn primary" type="submit">
            查询
          </button>
        </form>
      </Card>

      <Card title="查询结果" sub={`${parts.length} 条${parts.length >= 100 ? "(已截断至 100 条)" : ""}`} flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>内部料号</th>
                <th>MPN</th>
                <th>制造商</th>
                <th>描述</th>
                <th>封装</th>
                <th>生命周期</th>
                <th>DC</th>
                <th className="num">库存</th>
                <th className="num">呆滞</th>
                <th>数据更新</th>
              </tr>
            </thead>
            <tbody>
              {parts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    {keyword ? "无匹配物料" : "暂无物料缓存"}
                  </td>
                </tr>
              ) : (
                parts.map((p) => {
                  const snap = latestByPart.get(p.id);
                  return (
                    <tr key={p.id} className={p.lifecycle === "EOL" || p.lifecycle === "OBSOLETE" ? "row-danger" : undefined}>
                      <td className="mono small">{p.internalPn}</td>
                      <td className="mono small">{p.mpn ?? "-"}</td>
                      <td className="small">{p.manufacturer ?? "-"}</td>
                      <td className="small">{p.description ?? "-"}</td>
                      <td className="small">{p.footprint ?? "-"}</td>
                      <td>
                        <Badge
                          tone={
                            p.lifecycle === "ACTIVE"
                              ? "green"
                              : p.lifecycle === "NRND"
                                ? "amber"
                                : p.lifecycle === "UNKNOWN"
                                  ? "gray"
                                  : "red"
                          }
                        >
                          {p.lifecycle}
                        </Badge>
                      </td>
                      <td className="small">{p.dateCode ?? <span className="muted">未知</span>}</td>
                      <td className="num">
                        {snap ? Number(snap.qtyOnHand) : <span className="muted">未知</span>}
                      </td>
                      <td className="num">
                        {snap?.qtySlowMoving === null || snap?.qtySlowMoving === undefined ? (
                          <span className="muted">未知</span>
                        ) : (
                          Number(snap.qtySlowMoving)
                        )}
                      </td>
                      <td className="small">
                        {snap?.fetchedAt.toISOString().slice(0, 16).replace("T", " ") ??
                          p.syncedAt?.toISOString().slice(0, 16).replace("T", " ") ?? (
                            <span className="muted">未知</span>
                          )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="外部数据源状态" sub="PR3 / PR4 · Provider 层">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>数据源</th>
                <th>本环境形态</th>
                <th>联调记录</th>
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
                      <Badge tone="amber">示例数据 · 本环境未配置凭据</Badge>
                    ) : (
                      <Badge tone="green">已配置凭据</Badge>
                    )}
                  </td>
                  <td>
                    {r.verified ? (
                      <Badge tone="green">已联调 · {r.verified}</Badge>
                    ) : (
                      <Badge tone="gray">待联调</Badge>
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
            DigiKey 与 Mouser 已于 2026-07-27 由 <code>pnpm smoke:external</code> 冒烟联调通过;
            ezPLM 仍为待联调。
            {anyHttp
              ? "本环境已配置凭据,查询走真实 API。"
              : "本环境未配置凭据,页面数据来自本地样例,不代表真实供应商行情。"}
          </span>
        </Banner>
        <Banner tone="warn">
          <span>
            <b>价格口径待确认</b>:DigiKey 换算币种价格是否含税、是否受账户协议价(Customer-Id)影响,
            尚待 DigiKey 官方文档与账户确认;系统不做汇率换算,异币种报价一律标注为
            <b>不可比</b>,同 MPN 异厂商报价标注为 <b>manufacturer_mismatch</b> 并排除出比价。
            价格、GTB、Markup、PPV 一律由确定性函数计算;排名仅为建议,正式供应商选择必须人工确认。
          </span>
        </Banner>
      </Card>
    </div>
  );
}
