"use client";

import { useRouter } from "next/navigation";

export function PortalLogout() {
  const router = useRouter();
  return (
    <button
      style={{ fontSize: 12, border: "1px solid #ddd", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer" }}
      onClick={async () => {
        await fetch("/api/portal/auth/logout", { method: "POST" });
        router.push("/portal/login");
        router.refresh();
      }}
    >
      退出
    </button>
  );
}
