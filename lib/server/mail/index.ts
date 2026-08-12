/**
 * SMTP 邮件 Provider(E7 / 客户 Q3:发送 = 公司 SMTP)。
 *
 * 状态如实说明:**参数未到,尚未联调**(OPEN-QUESTIONS O4)。
 *
 * - 未配置时 `send()` **抛错**,不返回"成功"、也不静默吞掉 ——
 *   业务侧据此把邮件停在 DRAFT,界面只显示「草稿 · 未发送」;
 * - 配置齐全后走 nodemailer,真实发送;
 * - **口令只从服务端环境变量读,任何日志与错误信息都不输出明文**。
 */
import nodemailer, { type Transporter } from "nodemailer";
import { resolveSmtpConfig, type SmtpConfigResult } from "@/lib/domain/mail-receipt";

export class SmtpNotConfiguredError extends Error {
  readonly code = "smtp_not_configured";
  constructor(public readonly missing: string[]) {
    super(
      `SMTP 尚未配置,缺少:${missing.join("、")}。` +
        "在参数到位之前,邮件一律停在「草稿 · 未发送」—— 系统不会假装已经发出去。",
    );
  }
}

export interface SendInput {
  to: { email: string; name?: string | null }[];
  cc?: { email: string; name?: string | null }[];
  subject: string;
  body: string;
  /** 请求已读回执(Disposition-Notification-To / Return-Receipt-To) */
  requestReadReceipt?: boolean;
  attachments?: { filename: string; content: Buffer }[];
}

export interface SendResult {
  providerMessageId: string | null;
  accepted: string[];
  rejected: string[];
}

export interface MailProvider {
  readonly configured: boolean;
  readonly config: SmtpConfigResult;
  send(input: SendInput): Promise<SendResult>;
  /** 连接自检 —— 不发信,只验证能不能连上并通过鉴权 */
  verify(): Promise<{ ok: boolean; message: string }>;
}

function readConfig(): SmtpConfigResult {
  return resolveSmtpConfig({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
    secure: process.env.SMTP_SECURE,
  });
}

class SmtpMailProvider implements MailProvider {
  readonly config: SmtpConfigResult;
  private transporter: Transporter | null = null;

  constructor(config: SmtpConfigResult) {
    this.config = config;
  }

  get configured(): boolean {
    return this.config.configured;
  }

  private getTransporter(): Transporter {
    if (!this.config.configured) throw new SmtpNotConfiguredError(this.config.missing);
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host!,
        port: this.config.port!,
        secure: this.config.secure,
        auth: { user: this.config.user!, pass: process.env.SMTP_PASSWORD! },
      });
    }
    return this.transporter;
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    if (!this.config.configured) {
      return {
        ok: false,
        message: `未配置,缺少:${this.config.missing.join("、")}(状态:待客户提供,见 O4)`,
      };
    }
    try {
      await this.getTransporter().verify();
      return { ok: true, message: `已连通 ${this.config.host}:${this.config.port}` };
    } catch (e) {
      // 错误原文可能含服务器返回;**不回传任何口令**(口令从不进入这个字符串)
      return { ok: false, message: `连接失败:${(e as Error).message}` };
    }
  }

  async send(input: SendInput): Promise<SendResult> {
    if (!this.config.configured) throw new SmtpNotConfiguredError(this.config.missing);

    const headers: Record<string, string> = {};
    if (input.requestReadReceipt) {
      /*
       * 已读回执:两个头都带上,兼容不同客户端。
       * 但要记住 —— **对方客户端可以拒绝**,拿不到是常态,
       * 所以业务侧绝不能把"没回执"读成"没看"。
       */
      headers["Disposition-Notification-To"] = this.config.from!;
      headers["Return-Receipt-To"] = this.config.from!;
    }

    const info = await this.getTransporter().sendMail({
      from: this.config.from!,
      to: input.to.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)).join(", "),
      cc: input.cc?.length
        ? input.cc.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)).join(", ")
        : undefined,
      subject: input.subject,
      text: input.body,
      headers,
      attachments: input.attachments,
    });

    return {
      providerMessageId: info.messageId ?? null,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
    };
  }
}

export function getMailProvider(): MailProvider {
  return new SmtpMailProvider(readConfig());
}
