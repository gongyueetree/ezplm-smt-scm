"use client";

/**
 * 预 BOM → 正式 BOM 的转换入口(客户 Q4:「分两套 + 一键转换」)。
 *
 * 界面上刻意做成**两步**:先「试算匹配」看清有几行匹配不上,再「确认转换」。
 * 一键直接转过去会让人在毫不知情的情况下拿到一份缺内部料号的正式 BOM,
 * 而这份 BOM 后面是要拿去投产的。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

interface PreviewLine {
  lineNo: number;
  internalPn: string | null;
  source: string | null;
  ambiguous: boolean;
  reason: string | null;
}

interface Preview {
  lineCount: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  needsManual: number;
  truncationNote: string | null;
  lines: PreviewLine[];
}

export function ConvertPanel({
  bomId,
  purpose,
  customerId,
  customers,
  convertedFromBomId,
}: {
  bomId: string;
  purpose: "PRE_QUOTE" | "PRODUCTION";
  customerId: string | null;
  customers: { id: string; name: string }[];
  convertedFromBomId: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(customerId ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (purpose === "PRODUCTION") {
    return (
      <div className="banner soft" data-testid="convert-panel-production">
        这已经是<b>正式 BOM(量产用)</b>
        {convertedFromBomId ? ",由预 BOM 转换而来" : ""}。正式 BOM 不再转换 ——
        需要改动请回到源预 BOM 修改后重新转换,以免出现两份都叫「正式」的文件。
      </div>
    );
  }

  async function call(previewOnly: boolean, ack: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/bom/${bomId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: picked || null,
          previewOnly,
          acknowledgeUnmatched: ack,
        }),
      });
      const body = await res.json().catch(() => null);
      if (body?.preview) setPreview(body.preview);
      if (!res.ok) {
        setError(body?.error ?? `请求失败(HTTP ${res.status})`);
        return;
      }
      if (previewOnly) {
        // 试算不落库,这句必须说死,否则有人以为已经转了
        setNote(
          body.guard?.ok
            ? "试算完成 —— 尚未生成任何正式 BOM"
            : `试算完成 —— 尚未生成任何正式 BOM。${body.guard?.message ?? ""}`,
        );
        return;
      }
      setNote(body.note ?? "已生成正式 BOM");
      router.push(`/bom/version/${body.versionId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="convert-panel">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>客户(正式 BOM 必填)</span>
          <select
            aria-label="转换客户"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">未选择</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={() => void call(true, false)}>
          {busy ? "计算中…" : "试算内部料号匹配"}
        </button>
        <button
          className="btn primary"
          disabled={busy || !preview}
          onClick={() => void call(false, (preview?.needsManual ?? 0) > 0)}
        >
          {preview && preview.needsManual > 0
            ? `确认转换(带 ${preview.needsManual} 行待补)`
            : "确认转换"}
        </button>
      </div>

      <p className="small muted" style={{ marginTop: 6 }}>
        转换会<b>新建</b>一份正式 BOM,原预 BOM 不做任何改动 ——
        报价是按预 BOM 报的,改掉它等于抹掉报价依据。
        匹配顺序:<b>客户料号对照表 → MPN 精确匹配</b>;
        匹配不到<b>不会自动建料</b>(物料主数据以 ezPLM 为准)。
      </p>

      {error ? (
        <div className="banner warn" role="alert" style={{ marginTop: 8 }} data-testid="convert-error">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" style={{ marginTop: 8 }} data-testid="convert-note">
          {note}
        </div>
      ) : null}

      {preview ? (
        <div style={{ marginTop: 10 }} data-testid="convert-preview">
          <div className="small">
            共 <b>{preview.lineCount}</b> 行 · 已匹配 <b>{preview.matched}</b> · 多候选待人工{" "}
            <b>{preview.ambiguous}</b> · 未匹配 <b>{preview.unmatched}</b>
          </div>
          {preview.truncationNote ? (
            <div className="banner warn" style={{ marginTop: 6 }} data-testid="convert-truncated">
              {preview.truncationNote}
            </div>
          ) : null}
          <div className="tbl-scroll" style={{ marginTop: 6, maxHeight: 260 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">行号</th>
                  <th>内部料号</th>
                  <th>匹配来源</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.lineNo}>
                    <td className="num">{l.lineNo}</td>
                    <td>{l.internalPn ?? <span className="muted">待补</span>}</td>
                    <td className="small">
                      {l.source === "CUSTOMER_PN_MAPPING"
                        ? "客户料号对照表"
                        : l.source === "MPN_EXACT"
                          ? "MPN 精确匹配"
                          : "-"}
                    </td>
                    <td className="small muted">{l.reason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.lines.length < preview.lineCount ? (
            <p className="small muted">
              明细只显示前 {preview.lines.length} 行(共 {preview.lineCount} 行)。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
