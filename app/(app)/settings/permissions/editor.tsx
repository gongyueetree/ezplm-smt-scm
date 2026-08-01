"use client";

/**
 * 权限配置编辑器。
 *
 * 这个页面最有价值的不是"能改",而是**能回答「他为什么有这个权限」** ——
 * 三层叠加时,光看最终结果没法排查配错在哪一层,所以推演区把来源链完整列出来。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RoleName } from "@/lib/routes";

interface Config {
  grants: { id: string; role: string; permission: string }[];
  overrides: { id: string; userId: string; permission: string; granted: boolean; reason: string | null }[];
  users: { id: string; email: string; name: string; roles: string[] }[];
  roles: string[];
}

interface Explanation {
  permission: string;
  granted: boolean;
  decidedBy: string;
  trail: { source: string; detail: string }[];
}

const SOURCE_LABEL: Record<string, { text: string; tone: "green" | "blue" | "purple" | "red" | "gray" }> = {
  ROLE_DEFAULT: { text: "角色默认", tone: "green" },
  TENANT_GRANT: { text: "租户授予", tone: "blue" },
  USER_GRANT: { text: "用户授予", tone: "purple" },
  USER_REVOKE: { text: "用户回收", tone: "red" },
  NONE: { text: "未授予", tone: "gray" },
};

const ROLES: RoleName[] = ["PM", "PROCUREMENT", "ENGINEERING", "MANAGEMENT", "SUPPLIER"];

export function PermissionEditor({
  permissions,
  roleDefaults,
  initial,
  currentUserId,
}: {
  permissions: string[];
  roleDefaults: Record<string, readonly string[]>;
  initial: Config;
  currentUserId: string;
}) {
  const router = useRouter();
  const [config, setConfig] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explainUser, setExplainUser] = useState<string>("");
  const [explanations, setExplanations] = useState<Explanation[] | null>(null);

  const grantKey = (role: string, p: string) => `${role}:${p}`;
  const grantSet = new Set(config.grants.map((g) => grantKey(g.role, g.permission)));

  async function post(body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/settings/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) {
        setError(b?.error ?? "操作失败");
        return false;
      }
      const fresh = await fetch("/api/settings/permissions").then((r) => r.json());
      setConfig(fresh);
      if (explainUser) void loadExplain(explainUser);
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function loadExplain(userId: string) {
    setExplainUser(userId);
    if (!userId) {
      setExplanations(null);
      return;
    }
    const r = await fetch(`/api/settings/permissions?explain=${userId}`);
    if (!r.ok) return;
    const b = await r.json();
    setExplanations(b.explanations ?? []);
  }

  return (
    <>
      <Card
        title="租户级角色授予"
        sub="在角色默认之上额外授予;打勾即生效。角色默认(绿色)来自代码,不可在此更改"
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>权限</th>
                {ROLES.map((r) => (
                  <th key={r} className="num">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p}>
                  <td className="mono small">{p}</td>
                  {ROLES.map((r) => {
                    const isDefault = (roleDefaults[r] ?? []).includes(p);
                    const isGranted = grantSet.has(grantKey(r, p));
                    return (
                      <td key={r} className="num">
                        {isDefault ? (
                          <Badge tone="green">默认</Badge>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`${r} ${p}`}
                            checked={isGranted}
                            disabled={busy !== null}
                            onChange={(e) =>
                              void post(
                                { kind: "ROLE_GRANT", role: r, permission: p, enabled: e.target.checked },
                                grantKey(r, p),
                              )
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="生效权限推演" sub="回答「他为什么有/没有这个权限」">
        <label className="fld">
          <span>选择用户</span>
          <select value={explainUser} onChange={(e) => void loadExplain(e.target.value)}>
            <option value="">请选择</option>
            {config.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}({u.email}) · {u.roles.join("/")}
              </option>
            ))}
          </select>
        </label>

        {explanations ? (
          <div className="tbl-scroll" data-testid="perm-explain">
            <table className="tbl">
              <thead>
                <tr>
                  <th>权限</th>
                  <th>结果</th>
                  <th>由谁决定</th>
                  <th>来源链</th>
                  <th>用户级操作</th>
                </tr>
              </thead>
              <tbody>
                {explanations.map((e) => {
                  const ov = config.overrides.find(
                    (o) => o.userId === explainUser && o.permission === e.permission,
                  );
                  return (
                    <tr key={e.permission}>
                      <td className="mono small">{e.permission}</td>
                      <td>
                        <Badge tone={e.granted ? "green" : "gray"}>{e.granted ? "有" : "无"}</Badge>
                      </td>
                      <td className="small">
                        <Badge tone={SOURCE_LABEL[e.decidedBy]?.tone ?? "gray"}>
                          {SOURCE_LABEL[e.decidedBy]?.text ?? e.decidedBy}
                        </Badge>
                      </td>
                      <td className="small muted">
                        {e.trail.length === 0 ? "—" : e.trail.map((t) => t.detail).join(" → ")}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="btn xs"
                            disabled={busy !== null}
                            onClick={() =>
                              void post(
                                {
                                  kind: "USER_OVERRIDE",
                                  userId: explainUser,
                                  permission: e.permission,
                                  mode: "GRANT",
                                },
                                `u:${e.permission}`,
                              )
                            }
                          >
                            授予
                          </button>
                          <button
                            className="btn xs"
                            disabled={busy !== null}
                            onClick={() =>
                              void post(
                                {
                                  kind: "USER_OVERRIDE",
                                  userId: explainUser,
                                  permission: e.permission,
                                  mode: "REVOKE",
                                },
                                `u:${e.permission}`,
                              )
                            }
                          >
                            回收
                          </button>
                          {ov ? (
                            <button
                              className="btn xs"
                              disabled={busy !== null}
                              onClick={() =>
                                void post(
                                  {
                                    kind: "USER_OVERRIDE",
                                    userId: explainUser,
                                    permission: e.permission,
                                    mode: "CLEAR",
                                  },
                                  `u:${e.permission}`,
                                )
                              }
                            >
                              清除覆盖
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {explainUser === currentUserId ? (
              <p className="small muted" style={{ padding: "8px 16px" }}>
                你正在查看<b>自己</b>的权限 —— 系统不允许回收自己的「权限管理」权限,
                否则将无人能进入本页面。
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {error ? (
        <div className="banner warn" data-testid="perm-error">
          {error}
        </div>
      ) : null}
    </>
  );
}
