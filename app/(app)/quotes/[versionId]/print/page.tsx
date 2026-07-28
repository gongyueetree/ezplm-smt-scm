import { CATEGORY_LABELS, type QuoteCostCategoryValue } from "@/lib/domain/quote-calc";
import { getExportSnapshot } from "@/lib/server/repositories/quote";
import { getSession } from "@/lib/server/session";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * 报价单打印视图(Backlog B6)。
 *
 * SPEC §12:正式 PDF/XLSX **必须使用快照** —— 本页数据完全取自 approved/submitted 快照,
 * 不读当前行、不重算;无快照即拒绝渲染。
 *
 * ⚠ 交付边界(诚实说明):这是**浏览器打印视图**,经"打印 → 另存为 PDF"产出 PDF 文件。
 * 服务端直接生成 PDF 需要嵌入中文字体或引入无头浏览器,属后续工作(见 DEPLOYMENT.md)。
 */
export default async function QuotePrintPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const session = (await getSession())!;
  const source = await getExportSnapshot(session, versionId);

  if (!source.ok) {
    return (
      <div className="card">
        <div className="card-body">
          <h1 className="page-title">无法生成正式报价单</h1>
          <p className="small muted" style={{ marginTop: 8 }}>
            {source.message}
          </p>
          <p className="small muted">
            SPEC §12:正式文件必须基于冻结快照,系统不会用实时数据重算充当正式报价单。
          </p>
        </div>
      </div>
    );
  }

  const snap = source.snapshot;
  const s = snap.summary;

  return (
    <div className="print-doc">
      <div className="print-hide" style={{ marginBottom: 16 }}>
        <PrintButton />
        <p className="small muted" style={{ marginTop: 8 }}>
          数据来源:{source.kind === "approved" ? "审批快照(approvedSnapshot)" : "提交快照(submittedSnapshot)"}
          ,冻结于 {snap.frozenAt.slice(0, 19).replace("T", " ")}。
          浏览器打印对话框中选择「另存为 PDF」即可导出 PDF 文件。
        </p>
      </div>

      <header style={{ borderBottom: "2px solid var(--brand)", paddingBottom: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>报价单</h1>
            <p className="small muted" style={{ marginTop: 4 }}>
              硬禾科技 ezPLM · AI 供应链协同
            </p>
          </div>
          <div style={{ textAlign: "right" }} className="small">
            <div>
              <b>{snap.quoteCode}</b> · Revision {snap.revision}
            </div>
            <div className="muted">币种:{s.currency}</div>
            <div className="muted">冻结时间:{snap.frozenAt.slice(0, 10)}</div>
            <div className="muted">
              状态:{source.kind === "approved" ? "已批准" : "待审批"}
            </div>
          </div>
        </div>
      </header>

      <table className="tbl" style={{ marginBottom: 18 }}>
        <thead>
          <tr>
            <th>行</th>
            <th>成本分类</th>
            <th className="num">数量</th>
            <th className="num">采购成本</th>
            <th className="num">Markup</th>
            <th className="num">最终单价</th>
            <th className="num">客户单价</th>
            <th className="num">小计</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.length === 0 ? (
            <tr>
              <td colSpan={8} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                快照中无报价行
              </td>
            </tr>
          ) : (
            s.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="num">{l.lineNo}</td>
                <td>{CATEGORY_LABELS[l.category] ?? l.category}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{l.purchaseCost}</td>
                <td className="num">
                  {l.markupPct ? `${(Number(l.markupPct) * 100).toFixed(1)}%` : "-"}
                </td>
                <td className="num">{l.finalUnitPrice}</td>
                <td className="num">{l.effectiveUnitPrice}</td>
                <td className="num">{l.extended}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <table className="tbl" style={{ width: "min(420px, 100%)" }}>
          <tbody>
            {(Object.keys(s.byCategory) as QuoteCostCategoryValue[]).map((c) => (
              <tr key={c}>
                <td>{CATEGORY_LABELS[c]}</td>
                <td className="num">
                  {s.currency} {s.byCategory[c]}
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <b>总价</b>
              </td>
              <td className="num">
                <b>
                  {s.currency} {s.grandTotal}
                </b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="small muted" style={{ marginTop: 24, borderTop: "1px solid var(--gray-200)", paddingTop: 12 }}>
        本报价单内容取自系统冻结快照(Revision {snap.revision},冻结于{" "}
        {snap.frozenAt.slice(0, 19).replace("T", " ")}),与审批时一致。
        报价有效期与商务条款以双方书面合同为准。
      </footer>
    </div>
  );
}
