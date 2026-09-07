import { NextResponse } from "next/server";
import { PORTAL_COOKIE } from "@/lib/auth/portal-session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
