"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

const SAMPLE = `期间,客户,工单,MPN,发料数量,报废数量,原因
2026-07,LC,WO-1001,STM32F103C8T6,1000,12,上料错误
2026-07,LC,WO-1002,GRM188R71H104KA93D,5000,80,吸嘴异常`;

export function ScrapImport() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notices, setNotices] = useState<{ row: number; message: string }[]>([]);

  async function run() {
    setBusy(true);
    setMsg(null);
    setNotices([]);
    try {
      const res = await fetch("/api/scrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(body?.error ?? `导入失败(HTTP ${res.status})`);
        setNotices(Array.isArray(body?.errors) ? body.errors : []);
        return;
      }
      setMsg(`已导入 ${body.imported} 条`);
      setNotices(Array.isArray(body?.notices) ? body.notices : []);
      setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="导入损耗数据" sub="粘贴表格;必需列:发料数量、报废数量">
      <label className="fld">
        <span>损耗明细(Tab / 逗号分隔均可)</span>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={SAMPLE}
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn xs" onClick={() => setText(SAMPLE)}>
          填入示例
        </button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void run()}>
          {busy ? "导入中…" : "导入"}
        </button>
      </div>
      {msg ? (
        <div className="banner soft" style={{ marginTop: 10 }} data-testid="scrap-import-msg">
          {msg}
        </div>
      ) : null}
      {notices.length > 0 ? (
        <div className="banner warn" style={{ marginTop: 8 }}>
          <ul style={{ margin: "0 0 0 18px" }}>
            {notices.slice(0, 10).map((n, i) => (
              <li key={i} className="small">
                第 {n.row} 行:{n.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
