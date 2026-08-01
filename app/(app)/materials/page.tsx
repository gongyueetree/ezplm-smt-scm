import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { ezplmProviderMode } from "@/lib/providers/ezplm";
import { digiKeyMode } from "@/lib/providers/digikey";
import { mouserMode } from "@/lib/providers/mouser";
import { PageHeader } from "@/components/ui/page-header";
import { loadPermissions } from "@/lib/server/permissions";
import { CreatePartDrawer } from "./create-part-drawer";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { MpnLink } from "@/components/ui/mpn-link";
import { CATEGORY_L1 } from "@/lib/domain/part-category";

export const dynamic = "force-dynamic";

/**
 * 物料查询占位页 + 三方数据源状态(PR3/PR4)。
 * 诚实 UI 纪律:只区分「示例数据(Mock)/ 已配置凭据 · 待联调验证」,
 * 在冒烟脚本跑通并留痕之前,不出现任何"已联调/已接通"表述。
 */
const SOURCES = [
  {
    key: "ezPLM",
    // 手册确认:API Key 查询接口只有 parts 与 reference-designs 两类;
    // 库存 / 在途 / 客户料号映射 / 替代料 / 合规**接口侧不提供**,不得写进覆盖范围。
    scope:
      "物料主数据 · 规格参数 · 库文件(符号/封装/3D)· 数据手册 · 参考设计(只读真源);接口不提供库存/在途/客户料号映射/替代料/合规",
    mode: ezplmProviderMode,
    pr: "PR3",
    /** 联调记录:null = 尚未与真实环境联调 */
    verified: "2026-07-28 签名接口联调通过(物料详情页取真实数据)",
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
  searchParams: Promise<{ q?: string; l1?: string; l2?: string; tag?: string }>;
}) {
  const { q, l1, l2, tag } = await searchParams;
  const session = (await getSession())!;
  const [perms, suppliersForForm] = await Promise.all([
    loadPermissions(session),
    prisma.supplier.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  // 建料属工程职责;PM/采购默认只读,可经 UserPermission 单独授予
  const canCreate = perms.has("material.create");
  const keyword = (q ?? "").trim();

  // 分类与标签可与关键字**组合**筛选(客户 docx 抱怨过筛选区块彼此独立、无法联动)
  const categoryWhere = {
    ...(l1 ? { categoryL1: l1 } : {}),
    ...(l2 ? { categoryL2: l2 } : {}),
    ...(tag ? { tagLinks: { some: { tagId: tag } } } : {}),
  };

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
            ...categoryWhere,
          }
        : categoryWhere,
    ),
    orderBy: { internalPn: "asc" },
    take: 100,
    include: { processAttr: true },
  });

  const snapshots = parts.length
    ? await prisma.inventorySnapshot.findMany({
        where: tenantWhere(session.tenantId, { partId: { in: parts.map((p) => p.id) } }),
        orderBy: { fetchedAt: "desc" },
      })
    : [];
  const latestByPart = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) if (!latestByPart.has(s.partId)) latestByPart.set(s.partId, s);

  const [tags, l2Options, tagLinks] = await Promise.all([
    prisma.partTag.findMany({
      where: tenantWhere(session.tenantId),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // 二级细分是开放集合 —— 选项由库里已有的值派生,不硬编码一份清单
    prisma.part.findMany({
      where: tenantWhere(session.tenantId, {
        categoryL2: { not: null },
        ...(l1 ? { categoryL1: l1 } : {}),
      }),
      select: { categoryL2: true },
      distinct: ["categoryL2"],
      orderBy: { categoryL2: "asc" },
    }),
    parts.length
      ? prisma.partTagLink.findMany({
          where: tenantWhere(session.tenantId, { partId: { in: parts.map((p) => p.id) } }),
          select: { partId: true, tag: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const tagsByPart = new Map<string, { id: string; name: string }[]>();
  for (const link of tagLinks) {
    const arr = tagsByPart.get(link.partId) ?? [];
    arr.push(link.tag);
    tagsByPart.set(link.partId, arr);
  }

  const rows = SOURCES.map((s) => ({ ...s, mode: s.mode() }));
  const anyHttp = rows.some((r) => r.mode === "http");

  return (
    <div>
      <PageHeader
        path="/materials"
        actions={<CreatePartDrawer suppliers={suppliersForForm} canCreate={canCreate} />}
      />

      <Card title="物料查询" sub="ezPLM 只读缓存;显示缓存时点,不代表实时">
        <form method="get" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
            <span>关键字(MPN / 内部料号 / 制造商 / 描述)</span>
            <input name="q" defaultValue={keyword} placeholder="如 STM32 / 0603 / Murata" />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>一级大类</span>
            <select name="l1" defaultValue={l1 ?? ""}>
              <option value="">全部</option>
              {CATEGORY_L1.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>二级细分</span>
            <select name="l2" defaultValue={l2 ?? ""}>
              <option value="">全部</option>
              {l2Options.map((o) => (
                <option key={o.categoryL2!} value={o.categoryL2!}>
                  {o.categoryL2}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>
            <span>自定义标签</span>
            <select name="tag" defaultValue={tag ?? ""}>
              <option value="">全部</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit">
            查询
          </button>
        </form>
        <p className="small muted" style={{ marginTop: 8 }}>
          关键字、一级大类、二级细分、自定义标签<b>可组合</b>筛选。
          分类为<b>本地人工维护</b>:ezPLM 的分类串只作建议来源,映射不确定时留空 ——
          猜错的分类会一路带偏分组统计与替代料筛选。
        </p>
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
                <th>分类 / 标签</th>
                <th>SMT 工艺(MSL / 包装 / 盘装)</th>
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
                  <td colSpan={12} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                    {keyword ? "无匹配物料" : "暂无物料缓存"}
                  </td>
                </tr>
              ) : (
                parts.map((p) => {
                  const snap = latestByPart.get(p.id);
                  return (
                    <tr key={p.id} className={p.lifecycle === "EOL" || p.lifecycle === "OBSOLETE" ? "row-danger" : undefined}>
                      <td className="mono small">{p.internalPn}</td>
                      <td className="small">
                        <MpnLink mpn={p.mpn} />
                      </td>
                      <td className="small">{p.manufacturer ?? "-"}</td>
                      <td className="small">{p.description ?? "-"}</td>
                      <td className="small">{p.footprint ?? "-"}</td>
                      <td className="small">
                        {p.categoryL1 ? (
                          <div>
                            {p.categoryL1}
                            {p.categoryL2 ? <span className="muted"> / {p.categoryL2}</span> : null}
                          </div>
                        ) : (
                          <div className="muted">未分类</div>
                        )}
                        {(tagsByPart.get(p.id) ?? []).map((t) => (
                          <Badge key={t.id} tone="purple">
                            {t.name}
                          </Badge>
                        ))}
                      </td>
                      <td className="small">
                        {(() => {
                          const a = p.processAttr;
                          const msl = a?.msl ?? p.msl;
                          const pkg = a?.packaging ?? p.packaging;
                          const reel = a?.reelQty ?? null;
                          const localUsed =
                            (a?.msl ?? null) !== null ||
                            (a?.packaging ?? null) !== null ||
                            (a?.reelQty ?? null) !== null;
                          if (!msl && !pkg && reel === null) {
                            return (
                              <span className="muted">
                                未维护
                                <div>ezPLM 接口不提供,需本地填写</div>
                              </span>
                            );
                          }
                          return (
                            <>
                              <div>
                                {msl ?? "—"} / {pkg ?? "—"} / {reel ?? "—"}
                              </div>
                              <Badge tone={localUsed ? "green" : "amber"}>
                                {localUsed ? "本地维护" : "ezPLM 缓存"}
                              </Badge>
                            </>
                          );
                        })()}
                      </td>
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
            ezPLM 已于 2026-07-28 按《API 密钥查询接口用户操作手册》完成 HMAC 签名联调,
            物料详情页取到的是真实数据。
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
