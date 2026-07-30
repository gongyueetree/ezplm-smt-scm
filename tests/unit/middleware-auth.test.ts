import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

/** NextResponse.next() 带该内部头;被拦下的响应没有 */
function passedThrough(res: Response): boolean {
  return res.headers.has("x-middleware-next");
}

describe("中间件:无会话时的放行边界", () => {
  it("受保护页无会话 → 跳登录页", async () => {
    const res = await middleware(req("/materials"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("受保护 API 无会话 → 401", async () => {
    const res = await middleware(req("/api/materials/X/alternates"));
    expect(res.status).toBe(401);
  });

  it("登录页与登录接口放行", async () => {
    expect(passedThrough(await middleware(req("/login")))).toBe(true);
    expect(passedThrough(await middleware(req("/api/auth/login")))).toBe(true);
  });

  it("**定时任务接口必须放行** —— 它没有用户会话,鉴权靠路由内的 CRON_SECRET;中间件挡住的话外部调度器必然静默失效", async () => {
    const res = await middleware(req("/api/cron/opo-reminders"));
    expect(passedThrough(res)).toBe(true);
    expect(res.status).not.toBe(401);
  });

  it("放行只限 /api/cron 前缀,不得被相似路径蹭到", async () => {
    const res = await middleware(req("/api/cronx/steal"));
    expect(res.status).toBe(401);
  });
});
