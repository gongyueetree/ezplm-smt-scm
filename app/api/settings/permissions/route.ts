import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import {
  explainForUser,
  loadConfig,
  setRoleGrant,
  setUserOverride,
} from "@/lib/server/repositories/permission-admin";

export const runtime = "nodejs";

const ROLES = ["PM", "PROCUREMENT", "ENGINEERING", "MANAGEMENT", "SUPPLIER"] as const;

const Input = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ROLE_GRANT"),
    role: z.enum(ROLES),
    permission: z.string().trim().min(1).max(60),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("USER_OVERRIDE"),
    userId: z.string().trim().min(1),
    permission: z.string().trim().min(1).max(60),
    mode: z.enum(["GRANT", "REVOKE", "CLEAR"]),
    reason: z.string().trim().max(200).nullable().optional(),
  }),
]);

export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "settings.permissions.manage");
  if (!perm.ok) return perm.response;

  const explainUserId = new URL(req.url).searchParams.get("explain");
  if (explainUserId) {
    const r = await explainForUser(auth.session, explainUserId);
    if (!r) return notFound();
    return NextResponse.json(r);
  }
  return NextResponse.json(await loadConfig(auth.session));
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "settings.permissions.manage");
  if (!perm.ok) return perm.response;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("请求参数不合法");

  const r =
    parsed.data.kind === "ROLE_GRANT"
      ? await setRoleGrant(auth.session, parsed.data.role, parsed.data.permission, parsed.data.enabled)
      : await setUserOverride(
          auth.session,
          parsed.data.userId,
          parsed.data.permission,
          parsed.data.mode,
          parsed.data.reason,
        );

  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 422 });
  return NextResponse.json({ ok: true });
}
