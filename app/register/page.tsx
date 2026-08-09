"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

interface Options {
  enabled: boolean;
  roles?: { value: string; label: string }[];
  suppliers?: { id: string; name: string; code: string }[];
}

export default function RegisterPage() {
  const router = useRouter();
  const [opts, setOpts] = useState<Options | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [role, setRole] = useState("PM");
  const [supplierId, setSupplierId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/register")
      .then((r) => r.json())
      .then(setOpts)
      .catch(() => setOpts({ enabled: false }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // 两次口令的一致性在前端拦掉:后端拿不到"第二次输入",无从判断
    if (password !== password2) {
      setError("两次输入的口令不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, role, supplierId: supplierId || null }),
      });
      if (res.ok) {
        // 注册接口已下发会话 cookie,直接进工作台
        router.push("/");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "注册失败");
    } finally {
      setBusy(false);
    }
  }

  if (opts && !opts.enabled) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card" style={{ width: "min(420px, 100%)" }}>
          <div className="card-body" style={{ padding: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>注册未开放</div>
            <div className="small muted" data-testid="register-disabled">
              本系统当前未开放自助注册。如需账号请联系管理员开通。
            </div>
            <div className="divider" />
            <Link href="/login" className="btn">
              返回登录
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ width: "min(460px, 100%)" }}>
      <div className="card-body" style={{ padding: 28 }}>
      <div className="brand-logo" style={{ marginBottom: 18 }}>
        <div className="brand-mark">乾</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>乾创电子</div>
          <div className="small muted">AI 供应链协同 · 注册</div>
        </div>
      </div>
      <form onSubmit={submit}>
        <p className="small muted" style={{ marginBottom: 12 }}>
          注册后立即可用,与现有演示账号在同一套演示数据里 —— 你建的单据其他测试人员也能看到。
        </p>

        <label className="fld">
          <span>邮箱</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        <label className="fld">
          <span>姓名</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="fld">
          <span>角色</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {(opts?.roles ?? []).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {role === "SUPPLIER" ? (
          <label className="fld">
            <span>所属供应商</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">请选择</option>
              {(opts?.suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}({s.code})
                </option>
              ))}
            </select>
            <span className="small muted">
              供应商账号必须绑定归属 —— 系统靠它判断哪些在途行、询价与追溯数据与你相关。
            </span>
          </label>
        ) : null}

        <label className="fld">
          <span>口令(至少 8 位)</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        <label className="fld">
          <span>再输入一次</span>
          <input
            type="password"
            required
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        {error ? (
          <div className="banner warn" role="alert" data-testid="register-error">
            {error}
          </div>
        ) : null}

        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "注册中…" : "注册并进入"}
        </button>
      </form>
      <div className="divider" />
      <div className="small muted">
        已有账号?<Link href="/login">直接登录</Link>
      </div>
      </div>
      </div>
    </div>
  );
}
