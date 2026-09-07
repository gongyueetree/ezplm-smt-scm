"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AccountRow {
  id: string;
  email: string;
  customer: string;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
}

const STATUS_LABEL: Record<AccountRow["status"], string> = {
  INVITED: "已邀请 · 待激活",
  ACTIVE: "已激活",
  DISABLED: "已停用",
};

export function PortalAccountManager({
  accounts,
  customers,
}: {
  accounts: AccountRow[];
  customers: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 最近一次生成的激活链接(原始 token 只出现在这一屏,刷新即消失) */
  const [link, setLink] = useState<{ email: string; url: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function call(input: RequestInfo, init: RequestInit, tag: string) {
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch(input, init);
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        activateUrl?: string;
        note?: string;
      } | null;
      if (!res.ok) {
        setError(body?.error ?? "操作失败");
        return null;
      }
      return body;
    } finally {
      setBusy(null);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const body = await call(
      "/api/settings/portal-accounts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, email }),
      },
      "invite",
    );
    if (body?.activateUrl) {
      setLink({ email, url: body.activateUrl, note: body.note ?? "" });
      setCopied(false);
      setEmail("");
      router.refresh();
    }
  }

  async function patch(id: string, action: "disable" | "enable" | "reinvite", accountEmail: string) {
    const body = await call(
      `/api/settings/portal-accounts/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
      `${action}:${id}`,
    );
    if (body) {
      if (body.activateUrl) {
        setLink({ email: accountEmail, url: body.activateUrl, note: body.note ?? "" });
        setCopied(false);
      }
      router.refresh();
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <form onSubmit={invite} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="small" style={{ display: "block" }}>
          客户
          <br />
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="门户客户" required>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}({c.code})
              </option>
            ))}
          </select>
        </label>
        <label className="small" style={{ display: "block" }}>
          邮箱
          <br />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="门户邀请邮箱" required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy !== null || !customerId} data-testid="portal-invite-submit">
          {busy === "invite" ? "生成中…" : "邀请(生成激活链接)"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="small" style={{ color: "#c0392b" }} data-testid="portal-manage-error">
          {error}
        </p>
      ) : null}

      {link ? (
        <div
          style={{ marginTop: 12, padding: 12, background: "#f4faf4", border: "1px solid #cde8cd", borderRadius: 8 }}
          data-testid="portal-invite-link-box"
        >
          <div className="small">
            <strong>{link.email}</strong> 的一次性激活链接(仅本次显示,离开页面后无法找回,只能重新邀请):
          </div>
          <code className="small" style={{ wordBreak: "break-all", display: "block", margin: "6px 0" }} data-testid="portal-invite-link">
            {link.url}
          </code>
          <button type="button" className="btn" onClick={copy} data-testid="portal-invite-copy">
            {copied ? "已复制" : "复制链接"}
          </button>
          <span className="muted small" style={{ marginLeft: 8 }}>
            {link.note}
          </span>
        </div>
      ) : null}

      <div className="tbl-scroll" style={{ marginTop: 16 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>客户</th>
              <th>状态</th>
              <th>密码自设于</th>
              <th>最近登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 24 }}>
                  暂无门户账号
                </td>
              </tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id} data-testid={`portal-account-${a.email}`}>
                  <td className="small">{a.email}</td>
                  <td className="small">{a.customer}</td>
                  <td className="small" data-testid={`portal-status-${a.email}`}>
                    {STATUS_LABEL[a.status]}
                  </td>
                  <td className="small muted">{a.passwordChangedAt ? a.passwordChangedAt.slice(0, 10) : "—"}</td>
                  <td className="small muted">{a.lastLoginAt ? a.lastLoginAt.slice(0, 16).replace("T", " ") : "—"}</td>
                  <td className="small">
                    {a.status !== "DISABLED" ? (
                      <>
                        <button type="button" className="btn" disabled={busy !== null} onClick={() => patch(a.id, "reinvite", a.email)}>
                          重新邀请
                        </button>{" "}
                        <button type="button" className="btn" disabled={busy !== null} onClick={() => patch(a.id, "disable", a.email)}>
                          停用
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn" disabled={busy !== null} onClick={() => patch(a.id, "enable", a.email)}>
                        启用
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
