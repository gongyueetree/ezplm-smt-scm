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
 * 客户 docx 原话:「PDF 报价单生成的报价单目前是 copy 的系统界面,没有按照固定模式生成」。
 * 因此本页按**固定报价单格式**排版:甲乙方 / 单号与有效期 / 明细(含报价 MFG·MPN、
 * 物料类别、替代料)/ 分类汇总 / 商务条款 / 双方签署栏,而不是把系统界面照搬一遍。
 *
 * ⚠ 交付边界(诚实说明):这仍是**浏览器打印视图**,经"打印 → 另存为 PDF"产出 PDF。
 * 服务端直出 PDF 需嵌入中文字体或引入无头浏览器,属后续工作(见 DEPLOYMENT.md)。
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
  const doc = snap.doc ?? null;
  // 旧快照没有 docLines —— 一律显示「—」,**不回查当前行补齐**(那会破坏冻结语义)
  const docLineMap = new Map((snap.docLines ?? []).map((d) => [d.lineNo, d]));
  const docLineOf = (lineNo: number) => docLineMap.get(lineNo) ?? null;

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
            {/* 字距用 CSS 实现正式文档观感;**不在文本里塞空格** —— 那会破坏文本断言、复制粘贴与读屏 */}
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.35em" }}>报价单</h1>
            <p className="small muted" style={{ marginTop: 4 }}>QUOTATION</p>
          </div>
          <div style={{ textAlign: "right" }} className="small">
            <div>
              单号:<b>{snap.quoteCode}</b> · Rev {snap.revision}
            </div>
            <div className="muted">报价日期:{snap.frozenAt.slice(0, 10)}</div>
            <div className="muted">
              有效期至:
              {doc?.validUntil ? (
                <b>{doc.validUntil}</b>
              ) : (
                <span>未设置(以双方书面确认为准)</span>
              )}
            </div>
            <div className="muted">币种:{s.currency}</div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 12,
            fontSize: 12,
          }}
        >
          <div>
            <div className="muted">需求方(甲方)</div>
            <div>
              <b>{doc?.customerName ?? "—"}</b>
              {doc?.customerCode ? <span className="muted"> ({doc.customerCode})</span> : null}
            </div>
          </div>
          <div>
            <div className="muted">报价方(乙方)</div>
            <div>
              <b>{doc?.sellerName ?? "—"}</b>
            </div>
          </div>
        </div>

        {!doc ? (
          <p className="small" style={{ marginTop: 8, color: "var(--danger)" }}>
            ⚠ 该快照冻结于本功能上线之前,未包含甲乙方与有效期信息。
            系统<b>不会用当前数据补齐</b>(那会破坏冻结语义)—— 需要完整表头请新开 Revision 重新提交。
          </p>
        ) : null}
      </header>

      <table className="tbl" style={{ marginBottom: 18 }}>
        <thead>
          <tr>
            <th>行</th>
            <th>成本分类</th>
            <th>物料类别</th>
            <th>报价 MFG / MPN</th>
            <th>替代料 MFG / MPN</th>
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
              <td colSpan={11} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                快照中无报价行
              </td>
            </tr>
          ) : (
            s.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="num">{l.lineNo}</td>
                <td>{CATEGORY_LABELS[l.category] ?? l.category}</td>
                <td className="small">{docLineOf(l.lineNo)?.materialCategory ?? "—"}</td>
                <td className="small">
                  {docLineOf(l.lineNo)?.quotedMfg ?? "—"}
                  <div className="mono">{docLineOf(l.lineNo)?.quotedMpn ?? "—"}</div>
                </td>
                <td className="small">
                  {docLineOf(l.lineNo)?.altMpn ? (
                    <>
                      {docLineOf(l.lineNo)?.altMfg ?? "—"}
                      <div className="mono">{docLineOf(l.lineNo)?.altMpn}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
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

      <section style={{ marginTop: 22, fontSize: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>商务条款</div>
        <ol style={{ margin: "0 0 0 18px", lineHeight: 1.9 }}>
          <li>
            报价币种为 {s.currency};本报价<b>不含运费与关税</b>,税费口径以双方合同约定为准。
          </li>
          <li>
            有效期:
            {doc?.validUntil ? `至 ${doc.validUntil}` : "未设置,以双方书面确认为准"}
            ;超期需重新报价。
          </li>
          <li>物料价格随市场波动,交期与价格以正式订单确认时为准。</li>
          <li>替代料仅在甲方书面同意后方可使用。</li>
          <li>本报价单金额取自系统冻结快照,与审批记录一致。</li>
        </ol>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          marginTop: 28,
          fontSize: 12,
        }}
      >
        <div>
          <div className="muted">需求方(甲方)确认签章</div>
          <div style={{ borderBottom: "1px solid var(--gray-400)", height: 48, marginTop: 6 }} />
          <div className="muted" style={{ marginTop: 4 }}>日期:____________</div>
        </div>
        <div>
          <div className="muted">报价方(乙方)签章</div>
          <div style={{ borderBottom: "1px solid var(--gray-400)", height: 48, marginTop: 6 }} />
          <div className="muted" style={{ marginTop: 4 }}>日期:____________</div>
        </div>
      </section>

      <footer className="small muted" style={{ marginTop: 24, borderTop: "1px solid var(--gray-200)", paddingTop: 12 }}>
        本报价单内容取自系统冻结快照(Revision {snap.revision},冻结于{" "}
        {snap.frozenAt.slice(0, 19).replace("T", " ")}),与审批时一致。
        报价有效期与商务条款以双方书面合同为准。
      </footer>
    </div>
  );
}
