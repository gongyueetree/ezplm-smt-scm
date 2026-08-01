import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { listJobs } from "@/lib/server/repositories/erp-sync";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "erp.connection.view");
  if (!perm.ok) return perm.response;
  const { id } = await params;
  return NextResponse.json({ jobs: await listJobs(auth.session, id) });
}
