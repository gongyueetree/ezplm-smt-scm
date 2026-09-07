import { notFound } from "next/navigation";
import { portalGloballyEnabled } from "@/lib/server/portal";
import { PortalLoginForm } from "./form";

export const dynamic = "force-dynamic";

export default function PortalLoginPage() {
  if (!portalGloballyEnabled()) notFound();
  return (
    <div style={{ maxWidth: 380, margin: "80px auto", background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
      <h1 style={{ fontSize: 18 }}>客户门户登录</h1>
      <p style={{ fontSize: 12, color: "#888" }}>账号由供应链团队邀请开通;如需账号请联系您的对接人。</p>
      <PortalLoginForm />
    </div>
  );
}
