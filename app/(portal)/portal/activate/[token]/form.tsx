"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalActivateForm({ token }: { token: string }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/portal/activate/${token}`);
      const body = (await res.json().catch(() => null)) as { email?: string; error?: string } | null;
      if (cancelled) return;
      if (res.ok && body?.email) setEmail(body.email);
      else setInvalid(body?.error ?? "链接无效");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/activate/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "激活失败");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/portal/login"), 1200);
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = { width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", marginTop: 4 };

  if (invalid) {
    return (
      <p role="alert" style={{ color: "#c0392b", fontSize: 13, marginTop: 12 }} data-testid="portal-activate-invalid">
        {invalid}
      </p>
    );
  }
  if (done) {
    return (
      <p style={{ color: "#00890b", fontSize: 14, marginTop: 12 }} data-testid="portal-activate-done">
        激活成功,正在跳转登录页…
      </p>
    );
  }
  return (
    <form onSubmit={submit} style={{ marginTop: 12 }}>
      <p style={{ fontSize: 13 }} data-testid="portal-activate-email">
        账号:{email ?? "校验链接中…"}
      </p>
      <label style={{ fontSize: 13, display: "block", marginTop: 10 }}>
        设置密码
        <input style={box} type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="设置密码" minLength={8} required />
      </label>
      <label style={{ fontSize: 13, display: "block", marginTop: 10 }}>
        确认密码
        <input style={box} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="确认密码" minLength={8} required />
      </label>
      {error ? (
        <p role="alert" style={{ color: "#c0392b", fontSize: 13 }} data-testid="portal-activate-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !email}
        data-testid="portal-activate-submit"
        style={{ marginTop: 12, width: "100%", background: "#00890b", color: "#fff", border: 0, borderRadius: 8, padding: "10px 0", fontSize: 15, cursor: "pointer" }}
      >
        {busy ? "激活中…" : "激活并设置密码"}
      </button>
    </form>
  );
}
