import type { Metadata } from "next";
import { loadPublicView, type PublicView } from "@/lib/server/repositories/supplier-action";
import { ConfirmForm } from "./confirm-form";

export const dynamic = "force-dynamic";

// token 在路径里 —— 禁止外链带 Referer 泄露;不进搜索引擎(设计 §3)
export const metadata: Metadata = {
  title: "供应商确认",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * F3:供应商免登录确认页(公开;独立 route group,不挂内部 AppShell)。
 * 最小字段纪律见 docs/design/F3-CHECKPOINT-A.md §5:不显示单价/金额/内部备注。
 */
export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view: PublicView = /^[A-Za-z0-9_-]{20,64}$/.test(token)
    ? await loadPublicView(token)
    : { access: "not_found" };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
        <h1 style={{ fontSize: 18, margin: "0 0 4px" }}>ezPLM 供应链协同 · 供应商确认</h1>

        {view.access !== "ok" ? (
          view.access === "expired" ? (
            <p data-testid="confirm-expired">链接已过期,请联系采购重新发送。</p>
          ) : view.access === "already_responded" ? (
            <p data-testid="confirm-replayed">该链接已确认过 —— 如需修改,请联系采购重新发送新链接。</p>
          ) : (
            <p data-testid="confirm-invalid">链接无效。若您认为这是错误,请联系发送方重新获取链接。</p>
          )
        ) : (
          <ConfirmForm token={token} view={view} />
        )}

        <p style={{ color: "#888", fontSize: 12, marginTop: 24 }}>
          本页面通过一次性链接访问,无需登录;提交即视为贵司对上述内容的正式回复,将记录时间与来源用于审计。
        </p>
      </div>
    </div>
  );
}
