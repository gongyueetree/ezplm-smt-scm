import { NextResponse } from "next/server";
import { forbidden, requireSession } from "@/lib/server/api";
import { getMailProvider } from "@/lib/server/mail";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * E7:邮件通道状态(客户 Q3)。
 *
 * **只回状态,不回口令。** `resolveSmtpConfig` 的结果本身就不含密码,
 * 这里再确认一次:响应里只有 host/port/from/user 与缺失项清单。
 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "MANAGEMENT")) {
    return forbidden("邮件通道配置属管理层", "mail_settings_role");
  }

  const provider = getMailProvider();
  const [drafts, queued, sent, failed] = await Promise.all([
    prisma.outboundMessage.count({ where: tenantWhere(auth.session.tenantId, { state: "DRAFT" as const }) }),
    prisma.outboundMessage.count({ where: tenantWhere(auth.session.tenantId, { state: "QUEUED" as const }) }),
    prisma.outboundMessage.count({ where: tenantWhere(auth.session.tenantId, { state: "SENT" as const }) }),
    prisma.outboundMessage.count({ where: tenantWhere(auth.session.tenantId, { state: "DELIVERY_FAILED" as const }) }),
  ]);

  return NextResponse.json({
    configured: provider.configured,
    missing: provider.config.missing,
    host: provider.config.host,
    port: provider.config.port,
    secure: provider.config.secure,
    from: provider.config.from,
    user: provider.config.user,
    counts: { drafts, queued, sent, failed },
    status: provider.configured ? "CONFIGURED" : "WAITING_FOR_CREDENTIALS",
    note: provider.configured
      ? "SMTP 参数齐全。**是否真的能发,以「连接自检」结果为准** —— 参数写对了不等于连得上。"
      : "SMTP 参数未齐(见 OPEN-QUESTIONS O4)。在参数到位之前,所有邮件停在「草稿 · 未发送」,系统不会假装已发出。",
  });
}

/** 连接自检:只验证能不能连上并通过鉴权,**不发任何邮件** */
export async function POST() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  if (!auth.session.roles.some((r) => r === "MANAGEMENT")) {
    return forbidden("邮件通道自检属管理层", "mail_settings_role");
  }
  const result = await getMailProvider().verify();
  return NextResponse.json({
    ...result,
    note: "自检只验证连接与鉴权,**没有发送任何邮件**。",
  });
}
