"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { BomIssue } from "@/lib/domain/bom-validate";

interface ImportResponse {
  job: { id: string; totalLines: number; processedLines: number; batchSize: number };
  bomVersionId: string;
  validation: { issues: BomIssue[]; errorCount: number; warningCount: number; blocked: boolean };
  mapping: { fields: Record<string, number>; headerRowIndex: number; confidence: number; unmapped: { header: string }[] };
  uniqueMpns: number;
  usesBatching: boolean;
  archivedOnly: { fileName: string; reason: string }[];
  extractions: { fileName: string; source: string; isDraft: boolean; note?: string }[];
  /** spreadsheet(表格)/ pdf-text(PDF 文本层,确定性)/ ocr(模型转写草稿) */
  source: string;
  isDraft: boolean;
  sourceNote?: string;
  missingRecommended: string[];
  inferredMpnCount: number;
  /** E1a:行去向对账 */
  reconciliation?: {
    totalRows: number;
    recognized: number;
    mergedIntoPrevious: number;
    nonBusiness: number;
    needsReview: number;
    withIssues: number;
    balanced: boolean;
    byDisposition: Record<string, number>;
  };
  idempotentHit: { createdAt: string } | null;
}

const SOURCE_LABEL: Record<string, { text: string; tone: "green" | "blue" | "amber" }> = {
  spreadsheet: { text: "表格解析(确定性)", tone: "green" },
  "pdf-text": { text: "PDF 文本层重建(确定性)", tone: "blue" },
  ocr: { text: "模型转写草稿 · 须逐行人工核对", tone: "amber" },
};

interface Progress {
  total: number;
  processed: number;
  percent: number;
  done: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  refDes: "位号",
  qty: "数量",
  mpn: "MPN",
  manufacturer: "制造商",
  customerPn: "客户料号",
  internalPn: "内部料号",
  description: "描述",
  footprint: "封装",
};

export function ImportWizard({ rfqs }: { rfqs: { id: string; code: string; title: string }[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rfqId, setRfqId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * D-4:后端在列映射失败时**已经返回**缺哪列、认出了哪些列、前几行预览,
   * 原先前端只显示 body.error 一句话,这些全丢了 —— 客户既不知道缺什么,
   * 也不知道系统到底读懂了多少,只能猜是不是格式不兼容。
   */
  const [mappingHelp, setMappingHelp] = useState<{
    missingFields: string[];
    detectedFields: string[];
    preview: string[][];
  } | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [degraded, setDegraded] = useState<{ provider: string; kind: string; message: string }[]>([]);

  async function upload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("请先选择文件");
      return;
    }
    setBusy(true);
    setError(null);
    setMappingHelp(null);
    setResult(null);
    setProgress(null);
    setDegraded([]);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      if (rfqId) fd.append("rfqId", rfqId);
      const res = await fetch("/api/bom/import", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "导入失败");
        if (Array.isArray(body?.missingFields) && body.missingFields.length > 0) {
          setMappingHelp({
            missingFields: body.missingFields as string[],
            detectedFields: (body.detectedFields as string[]) ?? [],
            preview: (body.preview as string[][]) ?? [],
          });
        }
        return;
      }
      setResult(body as ImportResponse);
      await runMatching((body as ImportResponse).job.id);
    } finally {
      setBusy(false);
    }
  }

  /** 拉取式推进:逐批调用直到完成(与 SSE 端点同一套后端逻辑) */
  async function runMatching(jobId: string) {
    for (let i = 0; i < 200; i++) {
      const res = await fetch(`/api/bom/import/${jobId}`);
      if (!res.ok) {
        setError("匹配进度获取失败");
        return;
      }
      const body = (await res.json()) as {
        progress: Progress;
        degraded: { provider: string; kind: string; message: string }[];
      };
      setProgress(body.progress);
      if (body.degraded.length > 0) {
        setDegraded((prev) => [...prev, ...body.degraded]);
      }
      if (body.progress.done) return;
    }
  }

  return (
    <div>
      <Card title="① 上传 BOM 文件">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="fld" style={{ marginBottom: 0, minWidth: 220 }}>
            <span>关联 RFQ(可选)</span>
            <select value={rfqId} onChange={(e) => setRfqId(e.target.value)}>
              <option value="">不关联</option>
              {rfqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.title}
                </option>
              ))}
            </select>
          </label>
          <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 260 }}>
            <span>选择文件(可多选)</span>
            <input ref={fileRef} type="file" multiple />
          </label>
          <button className="btn primary" onClick={upload} disabled={busy}>
            {busy ? "处理中…" : "开始导入"}
          </button>
        </div>
        {error ? (
          <div className="banner warn" style={{ marginTop: 12 }} role="alert">
            {error}
          </div>
        ) : null}

        {mappingHelp ? (
          <div style={{ marginTop: 10 }} data-testid="mapping-help">
            <div className="small">
              <b>没认出的列:</b>
              {mappingHelp.missingFields.join("、")}
            </div>
            {mappingHelp.detectedFields.length > 0 ? (
              <div className="small muted" style={{ marginTop: 2 }}>
                已认出:{mappingHelp.detectedFields.join("、")} —— 文件本身能读,只差上面这些列。
              </div>
            ) : null}
            {mappingHelp.preview.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                <div className="small muted">文件前几行(用来对照表头写法):</div>
                <div className="tbl-scroll">
                  <table className="tbl">
                    <tbody>
                      {mappingHelp.preview.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j} className="small">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {result ? (
        <>
          <Card
            title="② 列映射识别结果"
            sub={`表头第 ${result.mapping.headerRowIndex + 1} 行 · 置信度 ${(result.mapping.confidence * 100).toFixed(0)}%`}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(result.mapping.fields).map(([field, col]) => (
                <Badge key={field} tone="green">
                  {FIELD_LABELS[field] ?? field} → 第 {col + 1} 列
                </Badge>
              ))}
              {result.mapping.unmapped.map((u, i) => (
                <Badge key={`u-${i}`} tone="gray">
                  未识别:{u.header}
                </Badge>
              ))}
            </div>
          </Card>

          {/*
            E1a(客户 Q13:「AI 无法全部识别,数据会丢失」)。
            这张卡片回答的就是那句话:**原始多少行、每一行去了哪里**。
            它排在校验之前 —— 先说清没丢东西,再谈数据对不对。
          */}
          {result.reconciliation ? (
            <Card
              title="③ 行去向对账"
              sub="原始文件的每一行都必须有去向 —— 系统不会悄悄丢行"
            >
              <div className="kpi-grid" data-testid="import-reconciliation">
                <div className="kpi">
                  <div className="kpi-label">原始行数</div>
                  <div className="kpi-value">{result.reconciliation.totalRows}</div>
                  <div className="kpi-foot">表头之后的全部行(含空行)</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">已识别为物料</div>
                  <div className="kpi-value">{result.reconciliation.recognized}</div>
                  <div className="kpi-foot">其中 {result.reconciliation.withIssues} 行带解析问题</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">并入上一行</div>
                  <div className="kpi-value">{result.reconciliation.mergedIntoPrevious}</div>
                  <div className="kpi-foot">位号/描述折行</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">非业务行</div>
                  <div className="kpi-value">{result.reconciliation.nonBusiness}</div>
                  <div className="kpi-foot">空行 / 重复表头 / 页脚</div>
                </div>
                <div
                  className={result.reconciliation.needsReview > 0 ? "kpi warn" : "kpi"}
                  data-testid="recon-needs-review"
                >
                  <div className="kpi-label">待人工判断</div>
                  <div className="kpi-value">{result.reconciliation.needsReview}</div>
                  <div className="kpi-foot">没能判定是不是物料行</div>
                </div>
              </div>
              {result.reconciliation.balanced ? (
                <p className="small muted" style={{ marginTop: 8 }} data-testid="recon-balanced">
                  账已平:<b>{result.reconciliation.totalRows}</b> ={" "}
                  {result.reconciliation.recognized} 识别 + {result.reconciliation.mergedIntoPrevious} 并入 +{" "}
                  {result.reconciliation.nonBusiness} 非业务 + {result.reconciliation.needsReview} 待人工。
                  逐行明细见 <Link href={`/bom/imports/${result.job.id}`}>行去向明细</Link>。
                </p>
              ) : (
                <div className="banner warn" style={{ marginTop: 8 }} data-testid="recon-unbalanced">
                  <b>行去向对不上账</b> —— 这是系统缺陷,不是文件问题。请把本次导入编号
                  {result.job.id} 反馈给我们,在查清之前<b>不要以这份 BOM 为准</b>。
                </div>
              )}
              {result.reconciliation.needsReview > 0 ? (
                <div className="banner soft" style={{ marginTop: 8 }}>
                  有 <b>{result.reconciliation.needsReview}</b> 行没能判定是不是物料行。
                  它们<b>没有被丢掉</b>,在
                  <Link href={`/bom/imports/${result.job.id}`}>行去向明细</Link>里逐行可查 ——
                  确认是物料的话,请在原文件补上料号或位号后重传。
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card
            title="④ 导入校验"
            sub={`${result.job.totalLines} 行 · ${result.uniqueMpns} 个唯一 MPN · ${result.validation.errorCount} 错误 / ${result.validation.warningCount} 提示`}
          >
            {result.source ? (
              <div style={{ marginBottom: 10 }}>
                <Badge tone={SOURCE_LABEL[result.source]?.tone ?? "gray"}>
                  {SOURCE_LABEL[result.source]?.text ?? result.source}
                </Badge>
                {result.sourceNote ? (
                  <p className="small muted" style={{ marginTop: 6 }}>
                    {result.sourceNote}
                  </p>
                ) : null}
              </div>
            ) : null}
            {result.isDraft ? (
              <div className="banner warn">
                本次表格来自<b>模型转写</b>,属识别草稿:型号可能有形近字错误、行列可能错位。
                导入前请对照原件逐行核对;数量、单价等数值由系统按既有规则重新解析,<b>模型不参与任何计算</b>。
              </div>
            ) : null}
            {result.idempotentHit ? (
              <div className="banner warn">
                本次上传的文件与解析结果都与既有版本完全一致,已<b>复用既有版本</b>
                (创建于 {result.idempotentHit.createdAt.slice(0, 19).replace("T", " ")}),
                未新建版本。若你刚改过原始文件,请确认是否保存后再上传。
              </div>
            ) : null}
            {result.inferredMpnCount > 0 ? (
              <div className="banner ai">
                其中 <b>{result.inferredMpnCount}</b> 行的 MPN 是从 <b>Value 列推断</b>出来的
                (KiCad 这类工程 BOM 里,IC 的 Value 通常就是厂商型号,而阻容感的 Value 是参数)。
                这些行在匹配确认页会单独标注 <b>待人工确认</b> —— 推断错的型号会一路错到询价与报价,
                请逐行核对后再放行。
              </div>
            ) : null}
            {result.missingRecommended?.length ? (
              <div className="banner warn">
                本次未识别到 <b>{result.missingRecommended.join("、")}</b> 列。
                BOM 已导入,但缺 MPN 的行<b>无法做供应商匹配与比价</b> ——
                可在原文件补上该列后重新导入,或逐行人工填写。
                (工程侧直接导出的 BOM 常常只有 位号 / 数量 / Value / 封装。)
              </div>
            ) : null}
            {result.archivedOnly.length > 0 ? (
              <div className="banner warn">
                以下文件仅归档,未能自动识别:
                {result.archivedOnly.map((a) => `${a.fileName}(${a.reason})`).join(";")}
              </div>
            ) : null}
            {result.validation.issues.length === 0 ? (
              <p className="small muted">未发现问题。</p>
            ) : (
              <ul className="small" style={{ lineHeight: 1.9, paddingLeft: 18 }}>
                {result.validation.issues.slice(0, 50).map((i, idx) => (
                  <li key={idx}>
                    <Badge tone={i.level === "error" ? "red" : "amber"}>{i.level === "error" ? "错误" : "提示"}</Badge>{" "}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="⑤ 智能匹配进度"
            sub={result.usesBatching ? `分批处理,每批 ${result.job.batchSize} 行` : "行数较少,单批完成"}
          >
            {progress ? (
              <div>
                <div
                  style={{
                    height: 10,
                    background: "var(--gray-150)",
                    borderRadius: 999,
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      width: `${progress.percent}%`,
                      height: "100%",
                      background: progress.done ? "var(--brand)" : "var(--ai)",
                      transition: "width 200ms",
                    }}
                  />
                </div>
                <p className="small muted">
                  {progress.processed} / {progress.total} 行 · {progress.percent}%
                  {progress.done ? " · 已完成" : " · 进行中"}
                </p>
              </div>
            ) : (
              <p className="small muted">等待开始…</p>
            )}

            {degraded.length > 0 ? (
              <div className="banner warn" style={{ marginTop: 12 }}>
                <span>
                  <b>外部数据源降级</b>(不影响其余候选):
                  {degraded.slice(0, 3).map((d, i) => (
                    <span key={i}>
                      {" "}
                      {d.provider}/{d.kind}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}

            {progress?.done ? (
              <>
              <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className="btn primary" href={`/bom/version/${result.bomVersionId}`}>
                  进入匹配确认(需人工确认)
                </Link>
                <Link className="btn" href={`/bom/compare?to=${result.bomVersionId}`}>
                  与其它版本比对
                </Link>
                <a className="btn" href={`/api/bom/version/${result.bomVersionId}/export`}>
                  导出标准模板 BOM
                </a>
              </div>
              <p className="small muted" style={{ marginTop: 6 }}>
                每次导入都会新建一个 BOM(版本从 V1 起),所以这里不预设「上一版本」——
                点「与其它版本比对」后本次版本已选为<b>变更后</b>,再挑一个<b>变更前</b>版本即可。
              </p>
              </>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
