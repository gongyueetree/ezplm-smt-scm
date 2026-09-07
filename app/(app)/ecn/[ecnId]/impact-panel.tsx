"use client";

/**
 * F2(T2):影响分析只读面板。
 * 每卡带来源与取数时间;缺源/失败显示状态,**其它卡照常**(部分降级);
 * 生效策略与处置只是建议文本,不写入任何字段。
 */
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";

interface SourceResult<T> {
  state: "ok" | "not_configured" | "error";
  note: string | null;
  fetchedAt: string | null;
  items: T[];
}

interface Impact {
  erpTarget: string;
  affectedBoms: { bomId: string; bomName: string; versionNo: number; lineCount: number }[];
  oldInventory: SourceResult<{ materialCode: string; warehouse: string | null; lotNo: string | null; qty: string }>;
  newInventory: SourceResult<{ materialCode: string; qty: string }>;
  openPo: SourceResult<{ poNo: string; lineNo: number; mpn: string | null; qtyOrdered: string; eta: string | null }>;
  excess: SourceResult<{ materialCode: string | null; qty: string; usableQty: string | null }>;
  workOrders: SourceResult<{ workOrderNo: string; product: string | null; plannedQty: string; status: string | null }>;
  salesOrders: SourceResult<{ soNumber: string; customerCode: string; lines: number }>;
}

function SourceCard({
  title,
  source,
  render,
  testid,
}: {
  title: string;
  source: SourceResult<never> | SourceResult<unknown>;
  render: (items: unknown[]) => React.ReactNode;
  testid: string;
}) {
  return (
    <Card title={title} sub={source.fetchedAt ? `取数时间 ${source.fetchedAt.slice(0, 16).replace("T", " ")}` : undefined}>
      <div data-testid={testid} data-state={source.state}>
        {source.state === "not_configured" ? (
          <p className="small muted">数据源待接入:{source.note}</p>
        ) : source.state === "error" ? (
          <p className="small" style={{ color: "var(--danger)" }}>
            {source.note}
          </p>
        ) : source.items.length === 0 ? (
          <p className="small muted">无匹配记录(数据源正常)</p>
        ) : (
          render(source.items)
        )}
      </div>
    </Card>
  );
}

export function ImpactPanel({ ecnId }: { ecnId: string }) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/ecn/${ecnId}/impact`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active) setImpact(d);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [ecnId]);

  if (loading) return <p className="muted">影响分析加载中…</p>;
  if (!impact) return null;

  return (
    <div data-testid="ecn-impact-panel">
      <Banner tone="ai">
        <span>
          <b>影响分析(T2 · 只读)</b>:数据经 ErpProvider 派生
          {impact.erpTarget === "ERP_LAB" ? "(当前目标:ERP 仿真环境,非金蝶)" : ""}
          ;单个数据源失败不影响其它卡;<b>生效策略与库存处置由人工决定</b>,本面板不写入任何字段。
        </span>
      </Banner>

      <Card title="受影响 BOM(本系统数据)">
        {impact.affectedBoms.length === 0 ? (
          <p className="small muted">没有 BOM 行引用旧料</p>
        ) : (
          <ul className="small" data-testid="impact-boms">
            {impact.affectedBoms.map((b) => (
              <li key={b.bomId + b.versionNo}>
                {b.bomName} V{b.versionNo} · {b.lineCount} 行
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SourceCard
        title="旧料库存(数量/仓/批次)"
        source={impact.oldInventory}
        testid="impact-old-inventory"
        render={(items) => (
          <ul className="small">
            {(items as Impact["oldInventory"]["items"]).slice(0, 20).map((i, k) => (
              <li key={k}>
                {i.materialCode} · {i.qty}(仓 {i.warehouse ?? "?"} · 批 {i.lotNo ?? "?"})
              </li>
            ))}
          </ul>
        )}
      />
      <SourceCard
        title="替代料(新料)库存"
        source={impact.newInventory}
        testid="impact-new-inventory"
        render={(items) => (
          <ul className="small">
            {(items as Impact["newInventory"]["items"]).slice(0, 20).map((i, k) => (
              <li key={k}>
                {i.materialCode} · {i.qty}
              </li>
            ))}
          </ul>
        )}
      />
      <SourceCard
        title="在途采购(旧料)"
        source={impact.openPo}
        testid="impact-open-po"
        render={(items) => (
          <ul className="small">
            {(items as Impact["openPo"]["items"]).slice(0, 20).map((p, k) => (
              <li key={k}>
                {p.poNo}#{p.lineNo} · {p.mpn ?? "?"} · {p.qtyOrdered}(ETA {p.eta ?? "未知"})
              </li>
            ))}
          </ul>
        )}
      />
      <SourceCard
        title="呆滞(旧料)"
        source={impact.excess}
        testid="impact-excess"
        render={(items) => (
          <ul className="small">
            {(items as Impact["excess"]["items"]).slice(0, 20).map((x, k) => (
              <li key={k}>
                {x.materialCode ?? "?"} · 账面 {x.qty} · 可用 {x.usableQty ?? "未知"}
              </li>
            ))}
          </ul>
        )}
      />
      <SourceCard
        title="工单(全量口径:头级数据无法按物料过滤,请工程核对)"
        source={impact.workOrders}
        testid="impact-work-orders"
        render={(items) => (
          <ul className="small">
            {(items as Impact["workOrders"]["items"]).slice(0, 20).map((w, k) => (
              <li key={k}>
                {w.workOrderNo} · {w.product ?? "?"} · {w.plannedQty} · {w.status ?? "?"}
              </li>
            ))}
          </ul>
        )}
      />
      <SourceCard
        title="销售订单"
        source={impact.salesOrders}
        testid="impact-sales-orders"
        render={(items) => (
          <ul className="small">
            {(items as Impact["salesOrders"]["items"]).slice(0, 20).map((so, k) => (
              <li key={k}>
                {so.soNumber} · 客户 {so.customerCode} · {so.lines} 行
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
