/**
 * 邮件草稿生成(客户 docx 三项:批量发送订单 / 订单接受通知 / 供应商资料邮件直发建档)。
 *
 * **邮件通道未接入**。本模块只负责把"要发什么、发给谁"组织成可复制、可下载的草稿,
 * 措辞上不得出现任何已发送的暗示 —— 这是 CLAUDE.md 的诚实 UI 铁律:
 * 邮件一律是预览/模拟,禁止「已发送/已生成/已联调」类虚假完成态。
 *
 * 纯函数:同样的输入永远得到同样的正文,便于单测与人工核对。
 */

export type EmailDraftKind = "PO_DISPATCH" | "PO_ACK_REQUEST" | "SUPPLIER_ONBOARD";

export interface PoDispatchInput {
  poNo: string;
  supplierName: string;
  contactName: string | null;
  currency: string;
  lines: { lineNo: number; mpn: string | null; qty: string; requestDate: string | null }[];
  /** 需人工另行附上的文件说明 */
  attachments: string[];
  sellerName: string;
}

export interface SupplierOnboardInput {
  companyName: string | null;
  inviteUrl: string;
  expiresAt: string | null;
  sellerName: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  attachments: string[];
  /** 明确告知调用方:本草稿**不会被系统发送** */
  deliveryNote: string;
}

const NOT_SENT_NOTE =
  "本邮件为系统生成的**草稿**:邮件通道未接入,系统不会自动发送。请复制或下载后由人工发出。";

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "待定";
}

/** 批量发送订单:一封信对应一张 PO */
export function buildPoDispatchDraft(input: PoDispatchInput): EmailDraft {
  const greeting = input.contactName ? `${input.contactName} 您好:` : `${input.supplierName} 您好:`;
  const rows = input.lines
    .map(
      (l) =>
        `  ${l.lineNo}. ${l.mpn ?? "(未填 MPN)"} × ${l.qty}` +
        `,需求日期 ${fmtDate(l.requestDate)}`,
    )
    .join("\n");

  return {
    subject: `【采购订单】${input.poNo} — ${input.sellerName}`,
    body: [
      greeting,
      "",
      `现向贵司下达采购订单 ${input.poNo},币种 ${input.currency},明细如下:`,
      rows || "  (无行项)",
      "",
      "请回复本邮件确认接单,并提供预计交期(ETA)。若有 MOQ、SPQ 或交期限制请一并说明。",
      "",
      input.attachments.length > 0
        ? `随附文件:${input.attachments.join("、")}`
        : "如需订单明细表,请向我方索取。",
      "",
      `${input.sellerName}`,
    ].join("\n"),
    attachments: input.attachments,
    deliveryNote: NOT_SENT_NOTE,
  };
}

/** 供应商建档邀请:请对方自助回填资料 */
export function buildSupplierOnboardDraft(input: SupplierOnboardInput): EmailDraft {
  return {
    subject: `【供应商资料登记】请协助完善贵司信息 — ${input.sellerName}`,
    body: [
      `${input.companyName ?? "您好"}:`,
      "",
      `为完成贵司在我方系统中的建档,烦请通过以下链接填写公司资料与联系人信息:`,
      input.inviteUrl,
      "",
      input.expiresAt
        ? `该链接有效期至 ${fmtDate(input.expiresAt)},逾期请联系我方重新获取。`
        : "如链接失效请联系我方重新获取。",
      "",
      "提交后由我方人员复核并完成建档;在复核通过前,所填资料不会进入正式主数据。",
      "",
      `${input.sellerName}`,
    ].join("\n"),
    attachments: [],
    deliveryNote: NOT_SENT_NOTE,
  };
}

/**
 * 草稿的状态措辞。
 * **不存在"已发送"** —— 传入任何未知状态时也只回落到"草稿",不臆造完成态。
 */
export function draftStatusLabel(status: string): string {
  switch (status) {
    case "PREVIEWED":
      return "已预览(未发送)";
    case "DRAFT":
    default:
      return "草稿(未发送)";
  }
}
