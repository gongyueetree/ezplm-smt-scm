import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/** 公开路径:登录页与登录接口;其余一律要求会话(Edge 验签,jose 兼容) */
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // 排除静态资源(含 public/vendor 下自发的 WASM —— 走鉴权会被 307 到登录页,
  // 3D 内核就永远加载不出来);页面与 API 全部经过会话检查
  matcher: ["/((?!_next/static|_next/image|vendor/|favicon.ico|.*\\.(?:svg|png|jpg|ico|wasm)$).*)"],
};
