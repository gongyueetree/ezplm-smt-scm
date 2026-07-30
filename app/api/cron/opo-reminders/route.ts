import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { runReminderScan } from "@/lib/server/repositories/opo";

export const runtime = "nodejs";

/**
 * 每日催办扫描(SPEC §14)。
 * 鉴权走 CRON_SECRET(不走用户会话);幂等键防重发;
 * ⚠ 本接口只落 ReminderLog(PENDING),**不真的发送邮件** ——
 * 邮件通道为预览/模拟,不得声称已发送。
 */
/**
 * GET 与 POST 同一套逻辑与同一套鉴权。
 * 需要 GET 是因为 **Vercel Cron 只发 GET**(且自动带 `Authorization: Bearer $CRON_SECRET`);
 * 自建 crontab / Railway 侧调度习惯用 POST。缺了 GET,Vercel 上的定时任务会 405 静默失效。
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 未配置,催办接口关闭(拒绝在无鉴权下运行)" },
      { status: 503 },
    );
  }
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const results = [];
  for (const t of tenants) {
    // Cron 无用户会话:以系统标识记 AuditLog
    const result = await runReminderScan(
      { tenantId: t.id, userId: "system:cron", roles: ["MANAGEMENT"] },
      now,
    );
    results.push({ tenantId: t.id, ...result });
  }

  return NextResponse.json({
    ok: true,
    now,
    results,
    note: "已生成催办记录(状态 PENDING);邮件发送为预览/模拟,尚未接入真实邮件通道",
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
