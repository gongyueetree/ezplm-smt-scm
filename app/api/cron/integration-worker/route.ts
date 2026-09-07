import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { runEtaWritebackWorker } from "@/lib/server/repositories/integration-worker";

export const runtime = "nodejs";

/**
 * closed-loop P0-7:集成 worker 定时轮(ETA_WRITEBACK 消费)。
 * 鉴权 CRON_SECRET(与催办 Cron 同一纪律);无会话时审计 actor 为 system:cron。
 * 供应商公开确认路径**不同步等待 ERP** —— 由本 worker 异步回写。
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 未配置,集成 worker 关闭(拒绝在无鉴权下运行)" },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const results = [];
  for (const t of tenants) {
    results.push({ tenantId: t.id, ...(await runEtaWritebackWorker(t.id, "system:cron")) });
  }
  return NextResponse.json({ ok: true, results });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
