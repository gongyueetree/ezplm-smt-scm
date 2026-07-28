import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  if (session) {
    await writeAudit(prisma, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "AUTH_LOGOUT",
      entityType: "User",
      entityId: session.userId,
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
