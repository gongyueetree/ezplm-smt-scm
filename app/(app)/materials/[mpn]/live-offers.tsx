"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface PriceBreak {
  minQty: number;
  unitPrice: string;
}

interface OfferRow {
  provider: string;
  providerPartNumber: string | null;
  manufacturer: string | null;
  mpn: string;
  packaging: string | null;
  stock: number | null;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  lifecycle: string;
  currency: string;
  priceBreaks: PriceBreak[];
  sourceUpdatedAt: string | null;
  sourceUrl: string | null;
  manufacturerMismatch: boolean;
}

interface Payload {
  offers: OfferRow[];
  degraded: { provider: string; kind: string; message: string }[];
  fetchedAt: string;
  fromCache: boolean;
  ttlSeconds: number;
  modes: { digikey: string; mouser: string };
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const LIFECYCLE_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  ACTIVE: "green",
  NRND: "amber",
  EOL: "red",
  OBSOLETE: "red",
  UNKNOWN: "gray",
};

/**
 * DigiKey / Mouser 的价格与库存。
 *
 * 诚实 UI:
 * - 标题写「价格与库存」而不是「实时价格」—— 数据经 15 分钟缓存,
 *   页面明确显示**数据更新时间**与是否命中缓存;
 * - 未配置凭据时标注为示例数据(Mock),不冒充已联调;
 * - 同号异厂料单独标红,价格不可与本厂料直接比较;系统不做汇率换算。
 */
export function LiveOffers({ mpn, manufacturer }: { mpn: string; manufacturer: string | null }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const qs = manufacturer ? `?manufacturer=${encodeURIComponent(manufacturer)}` : "";
      const res = await fetch(`${BASE_PATH}/api/materials/${encodeURIComponent(mpn)}/offers${qs}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `查询失败(HTTP ${res.status})`);
        return;
      }
      setData(body as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // mpn 变化时重查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpn]);

  const mockish =
    data && (data.modes.digikey === "mock" || data.modes.mouser === "mock");

  return (
    <div>
      <div style={{ padding: "12px 16px 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn sm" onClick={() => void load()} disabled={busy}>
          {busy ? "查询中…" : "刷新"}
        </button>
        {data ? (
          <span className="small muted">
            数据更新 {data.fetchedAt.slice(0, 19).replace("T", " ")}
            {data.fromCache ? "(命中缓存)" : "(本次调用三方 API)"} · 缓存{" "}
            {Math.round(data.ttlSeconds / 60)} 分钟 —— <b>非实时行情</b>
          </span>
        ) : null}
        {mockish ? (
          <Badge tone="amber">
            示例数据(DigiKey {data!.modes.digikey} / Mouser {data!.modes.mouser})
          </Badge>
        ) : null}
      </div>

      {error ? (
        <p className="small" style={{ padding: "8px 16px", color: "var(--danger)" }}>
          查询失败:{error}
        </p>
      ) : null}

      {data && data.degraded.length > 0 ? (
        <p className="small" style={{ padding: "8px 16px", color: "var(--warn, #b54708)" }}>
          外部数据源降级(已展示可用部分):
          {data.degraded.map((d, i) => (
            <span key={i}>
              {" "}
              {d.provider}/{d.kind} — {d.message}
            </span>
          ))}
        </p>
      ) : null}

      <div className="tbl-scroll" style={{ marginTop: 8 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>来源</th>
              <th>制造商</th>
              <th>包装</th>
              <th className="num">库存</th>
              <th className="num">MOQ / SPQ</th>
              <th className="num">交期</th>
              <th>生命周期</th>
              <th>阶梯价</th>
            </tr>
          </thead>
          <tbody>
            {busy && !data ? (
              <tr>
                <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                  正在向 DigiKey / Mouser 查询…
                </td>
              </tr>
            ) : !data || data.offers.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                  两个分销商都未返回该型号的报价
                </td>
              </tr>
            ) : (
              data.offers.map((o, i) => (
                <tr key={`${o.provider}-${o.providerPartNumber ?? i}`} className={o.manufacturerMismatch ? "row-danger" : undefined}>
                  <td className="small">
                    <Badge tone={o.provider === "DIGIKEY" ? "blue" : "purple"}>{o.provider}</Badge>
                    {o.sourceUrl ? (
                      <div>
                        <a className="small" href={o.sourceUrl} target="_blank" rel="noreferrer">
                          查看原页
                        </a>
                      </div>
                    ) : null}
                  </td>
                  <td className="small">
                    {o.manufacturer ?? "-"}
                    {o.manufacturerMismatch ? (
                      <div>
                        <Badge tone="red">同号异厂,不可比价</Badge>
                      </div>
                    ) : null}
                  </td>
                  <td className="small">{o.packaging ?? "-"}</td>
                  <td className="num small">{o.stock === null ? <span className="muted">未知</span> : o.stock}</td>
                  <td className="num small">
                    {o.moq ?? "-"} / {o.spq ?? "-"}
                  </td>
                  <td className="num small">{o.leadTimeDays === null ? "-" : `${o.leadTimeDays} 天`}</td>
                  <td>
                    <Badge tone={LIFECYCLE_TONE[o.lifecycle] ?? "gray"}>{o.lifecycle}</Badge>
                  </td>
                  <td className="small">
                    {o.priceBreaks.length === 0 ? (
                      <span className="muted">无阶梯价</span>
                    ) : (
                      o.priceBreaks.slice(0, 6).map((b, j) => (
                        <div key={j}>
                          {b.minQty}+ @ {o.currency} {b.unitPrice}
                        </div>
                      ))
                    )}
                    {o.sourceUpdatedAt ? (
                      <div className="muted">源数据 {o.sourceUpdatedAt.slice(0, 10)}</div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="small muted" style={{ padding: "10px 16px" }}>
        价格为分销商目录价,通常<b>不含关税、运费与进口税费</b>;各源币种原样展示,
        系统<b>不做汇率换算</b>,异币种不可直接比较。是否含税、是否受账户协议价影响
        <b>待三方官方文档与账户确认</b>。正式选型与采购以「采购 RFQ 比价」为准,须人工确认。
      </p>
    </div>
  );
}
