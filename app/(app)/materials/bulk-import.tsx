"use client";

/**
 * 批量导入建料(origin=IMPORTED)。
 *
 * 预览与执行分离:先看清楚会建多少、撞多少、疑似多少,再决定要不要写。
 * **疑似重复默认不建** —— 要建必须显式勾选,与手工建料同一套口径。
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IMPORT_TEMPLATE_HEADERS } from "@/lib/domain/part-bulk-import";

interface RowPlan {
  rowNo: number;
  internalPn: string;
  mpn: string;
  outcome: "WILL_CREATE" | "BLOCKED_DUPLICATE" | "SUSPECTED_DUPLICATE";
  reason: string | null;
}

interface Plan {
  rows: RowPlan[];
  willCreate: number;
  blocked: number;
  suspected: number;
}

const OUTCOME: Record<RowPlan["outcome"], { text: string; tone: "green" | "red" | "amber" }> = {
  WILL_CREATE: { text: "将创建", tone: "green" },
  BLOCKED_DUPLICATE: { text: "阻断·料号重复", tone: "red" },
  SUSPECTED_DUPLICATE: { text: "疑似·同 MPN", tone: "amber" },
};

export function BulkImportParts({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [includeSuspected, setIncludeSuspected] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /*
   * 预览回执。接口在 PREVIEW 时返回 note:「预览只计算计划,**未创建任何物料**」,
   * 原先前端只在 EXECUTE 时用 note,预览的这句**从没显示过** ——
   * 使用者只能靠"我按了哪个按钮"来判断有没有写库,这正是本项目要避免的诚实 UI 问题。
   */
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  /*
   * N-3:客户要「以附件(比如 xls)选择进行,不以文本形式导入」。
   * 文件优先;没选文件时仍可粘贴 —— 旧路径不删,有人已经习惯粘贴。
   */
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function run(mode: "PREVIEW" | "EXECUTE") {
    setBusy(mode);
    setError(null);
    setDone(null);
    setPreviewNote(null);
    try {
      const picked = fileRef.current?.files?.[0] ?? null;
      let res: Response;
      if (picked) {
        const fd = new FormData();
        fd.append("file", picked);
        fd.append("mode", mode);
        fd.append("includeSuspected", String(includeSuspected));
        res = await fetch("/api/materials/parts/bulk-import", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/materials/parts/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, mode, includeSuspected }),
        });
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "导入失败");
        setErrors(body?.errors ?? []);
        setNotices(body?.notices ?? []);
        setPlan(null);
        return;
      }
      setPlan(body.plan);
      setErrors(body.errors ?? []);
      setNotices(body.notices ?? []);
      setPreviewNote(mode === "PREVIEW" ? (body.note ?? null) : null);
      if (mode === "EXECUTE") {
        setDone(`已创建 ${body.created} 条${body.note ? ` · ${body.note}` : ""}`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  if (!canCreate) return null;

  if (!open) {
    return (
      // S-3:页头上和「新建物料」并排时,只写「批量导入」指代不清 —— 导入什么?
      <button className="btn" onClick={() => setOpen(true)}>
        批量导入物料
      </button>
    );
  }

  return (
    <Card title="批量导入物料" sub="上传 xlsx/csv 附件,或整块粘贴 · 预览后再执行">
      <label className="fld">
        <span>选择文件(xlsx / csv,必需列:内部料号、MPN)</span>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv,.txt"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <span className="small muted">
          选了文件就以文件为准,下面的粘贴框会被忽略。
        </span>
      </label>

      <label className="fld">
        <span>
          或粘贴表格{fileName ? "(已选文件,本框忽略)" : "(必需列:内部料号、MPN)"}
        </span>
        <textarea
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={IMPORT_TEMPLATE_HEADERS.join(",")}
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn xs" onClick={() => setText(IMPORT_TEMPLATE_HEADERS.join(","))}>
          填入表头模板
        </button>
        <button className="btn" disabled={busy !== null || (!text.trim() && !fileName)} onClick={() => void run("PREVIEW")}>
          {busy === "PREVIEW" ? "预览中…" : "预览"}
        </button>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={includeSuspected}
            onChange={(e) => setIncludeSuspected(e.target.checked)}
          />
          <span className="small">连疑似重复行一起创建</span>
        </label>
        <button
          className="btn primary"
          disabled={busy !== null || !plan || plan.willCreate + (includeSuspected ? plan.suspected : 0) === 0}
          onClick={() => void run("EXECUTE")}
        >
          {busy === "EXECUTE" ? "创建中…" : "执行导入"}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          关闭
        </button>
      </div>

      {notices.length > 0 ? (
        <div className="banner soft" style={{ marginTop: 8 }}>
          {notices.map((n, i) => (
            <div key={i} className="small">
              {n}
            </div>
          ))}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="banner warn" style={{ marginTop: 8 }} data-testid="bulk-errors">
          <b>解析报错 {errors.length} 条</b>(逐行列出,不静默丢弃):
          <ul style={{ margin: "6px 0 0 18px" }}>
            {errors.slice(0, 10).map((e, i) => (
              <li key={i} className="small">
                第 {e.row} 行:{e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="banner warn" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
      {done ? (
        <div className="banner soft" style={{ marginTop: 8 }} data-testid="bulk-done">
          {done}
        </div>
      ) : null}

      {plan ? (
        <div style={{ marginTop: 10 }} data-testid="bulk-plan">
          {previewNote ? (
            <div className="banner soft" data-testid="preview-note">
              {previewNote}
            </div>
          ) : null}
          <div className="banner soft">
            将创建 <b>{plan.willCreate}</b> · 阻断{" "}
            <b style={{ color: "var(--danger)" }}>{plan.blocked}</b> · 疑似重复{" "}
            <b>{plan.suspected}</b>
            {plan.suspected > 0 && !includeSuspected ? (
              <div className="small">疑似重复行默认<b>不创建</b> —— 需勾选上面的选项才会一并建</div>
            ) : null}
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>行</th>
                  <th>内部料号</th>
                  <th>MPN</th>
                  <th>结论</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice(0, 50).map((r) => (
                  <tr key={r.rowNo}>
                    <td>{r.rowNo}</td>
                    <td className="mono small">{r.internalPn}</td>
                    <td className="mono small">{r.mpn}</td>
                    <td className="small">
                      <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].text}</Badge>
                      {r.reason ? <div className="muted">{r.reason}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
