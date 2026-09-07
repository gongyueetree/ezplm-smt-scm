import { notFound } from "next/navigation";
import { portalGloballyEnabled } from "@/lib/server/portal";
import { PortalActivateForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * R3-3:门户账号激活页(公开;鉴权 = 一次性邀请 token)。
 * 密码由客户在此自设 —— 管理员全程不知道密码。
 * 具体校验(未知/过期/已用/停用)由 /api/portal/activate/[token] 判定,
 * 页面首次加载即询问,避免客户填完密码才发现链接失效。
 */
export default async function PortalActivatePage({ params }: { params: Promise<{ token: string }> }) {
  if (!portalGloballyEnabled()) notFound();
  const { token } = await params;
  return (
    <div style={{ maxWidth: 380, margin: "80px auto", background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
      <h1 style={{ fontSize: 18 }}>激活门户账号</h1>
      <p style={{ fontSize: 12, color: "#888" }}>请设置您的登录密码(至少 8 位)。密码只有您本人知道。</p>
      <PortalActivateForm token={token} />
    </div>
  );
}
