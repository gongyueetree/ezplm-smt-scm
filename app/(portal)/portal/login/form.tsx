"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PortalLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "登录失败");
        return;
      }
      router.push("/portal");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = { width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", marginTop: 4 };
  return (
    <form onSubmit={submit} style={{ marginTop: 12 }}>
      <label style={{ fontSize: 13 }}>
        邮箱
        <input style={box} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="门户邮箱" required />
      </label>
      <label style={{ fontSize: 13, display: "block", marginTop: 10 }}>
        密码
        <input style={box} type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="门户密码" required />
      </label>
      {error ? (
        <p role="alert" style={{ color: "#c0392b", fontSize: 13 }} data-testid="portal-login-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        data-testid="portal-login-submit"
        style={{ marginTop: 12, width: "100%", background: "#00890b", color: "#fff", border: 0, borderRadius: 8, padding: "10px 0", fontSize: 15, cursor: "pointer" }}
      >
        {busy ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
