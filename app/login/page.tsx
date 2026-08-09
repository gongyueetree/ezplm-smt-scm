"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** 演示账号(与 prisma/seed.ts 一致;仅种子数据,非硬编码后门) */
const DEMO_ACCOUNTS = [
  { email: "pm@demo.qianchuang.cn", label: "PM 经理" },
  { email: "procurement@demo.qianchuang.cn", label: "采购" },
  { email: "engineering@demo.qianchuang.cn", label: "工程" },
  { email: "management@demo.qianchuang.cn", label: "管理层" },
  { email: "supplier@demo.qianchuang.cn", label: "供应商" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ width: "min(420px, 100%)" }}>
        <div className="card-body" style={{ padding: 28 }}>
          <div className="brand-logo" style={{ marginBottom: 18 }}>
            <div className="brand-mark">乾</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>乾创电子</div>
              <div className="small muted">AI 供应链协同 · 登录</div>
            </div>
          </div>
          <form onSubmit={submit}>
            <label className="fld">
              <span>邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </label>
            <label className="fld">
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            {error ? (
              <div className="banner warn" role="alert">
                {error}
              </div>
            ) : null}
            <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "登录中…" : "登录"}
            </button>
          </form>
          <div className="divider" />
          <div className="small muted" style={{ marginBottom: 8 }}>
            演示账号(本地种子数据,密码见 seed 输出;点击填充邮箱):
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                className="btn sm"
                onClick={() => setEmail(a.email)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="divider" />
          <div className="small muted">
            没有账号?<Link href="/register">注册一个</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
