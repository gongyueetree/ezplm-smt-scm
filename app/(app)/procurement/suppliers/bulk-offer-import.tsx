"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * N-9(客户 PR2 反馈 采购-6B:「供应商与采购策略…需要批量导入」)。
 *
 * 与物料批量导入(N-3)同一套形态:上传 xlsx/csv → 预览 → 执行。
 * 表格**一行一档阶梯价**,与页面上的分行录入(D-2)口径一致。
 */
interface PlanRow {
  supplierCode: string;
  supplierName: string | null;
  mpn: string;
  breakCount: number;
  sourceRows: number[];
  outcome: "WILL_UPSERT" | "BLOCKED_NO_SUPPLIER" | "BLOCKED_SUPPLIER_INACTIVE";
  reason: string | null;
}

const TEMPLATE = ["供应商编码", "MPN", "制造商", "币种", "MOQ", "SPQ", "交期", "起订数量", "单价"];

export function BulkOfferImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(mode: "PREVIEW" | "EXECUTE") {
    const picked = fileRef.current?.files?.[0];
    if (!picked) {
      setError("请先选择文件");
      return;
    }
    setBusy(mode);
    setError(null);
    setNote(null);
    try {
      const fd = new FormData();
      fd.append("file", picked);
      fd.append("mode", mode);
      const res = await fetch("/api/procurement/supplier-offers/bulk-import", {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => null);
      setPlan(body?.plan ?? null);
      setErrors(body?.errors ?? []);
      setNotices(body?.notices ?? []);
      if (!res.ok) {
        setError(body?.error ?? "导入失败");
        return;
      }
      setNote(body?.note ?? null);
      if (mode === "EXECUTE") router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        批量导入供应商预设
      </button>
    );
  }

  return (
    <Card title="批量导入供应商预设" sub="xlsx / csv · 一行一档阶梯价 · 预览后再执行">
      <p className="small muted">
        表头:{TEMPLATE.join(" / ")}。同一个(供应商 + MPN)的多档价写成多行,导入时自动合并。
        供应商按<b>编码</b>匹配 —— 匹配不到的行会被拦下,<b>不会自动创建供应商</b>。
      </p>
      <label className="fld">
        <span>选择文件</span>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv,.txt"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" disabled={busy !== null || !fileName} onClick={() => void run("PREVIEW")}>
          {busy === "PREVIEW" ? "预览中…" : "预览"}
        </button>
        <button
          className="btn primary"
          disabled={busy !== null || !plan || errors.length > 0}
          onClick={() => void run("EXECUTE")}
        >
          {busy === "EXECUTE" ? "写入中…" : "执行导入"}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          关闭
        </button>
      </div>

      {error ? (
        <div className="banner warn" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" style={{ marginTop: 10 }} data-testid="offer-import-note">
          {note}
        </div>
      ) : null}
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
        <div className="banner warn" style={{ marginTop: 8 }} data-testid="offer-import-errors">
          <b>{errors.length} 处问题(全部修好后才能执行)</b>
          {errors.slice(0, 20).map((e, i) => (
            <div key={i} className="small">
              第 {e.row} 行:{e.message}
            </div>
          ))}
        </div>
      ) : null}

      {plan ? (
        <div className="tbl-scroll" style={{ marginTop: 10 }} data-testid="offer-import-plan">
          <table className="tbl">
            <thead>
              <tr>
                <th>供应商</th>
                <th>MPN</th>
                <th className="num">档数</th>
                <th>来源行</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p, i) => (
                <tr key={i}>
                  <td className="small">
                    {p.supplierName ?? <span className="muted">{p.supplierCode}(未匹配)</span>}
                  </td>
                  <td className="small">{p.mpn}</td>
                  <td className="num">{p.breakCount}</td>
                  <td className="small muted">{p.sourceRows.join("、")}</td>
                  <td>
                    {p.outcome === "WILL_UPSERT" ? (
                      <Badge tone="green">将写入</Badge>
                    ) : (
                      <Badge tone="red">{p.reason ?? "阻断"}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
