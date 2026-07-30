import { describe, expect, it } from "vitest";
import {
  buildPoDispatchDraft,
  buildSupplierOnboardDraft,
  draftStatusLabel,
} from "@/lib/domain/email-draft";

const PO = {
  poNo: "PO-2026-001",
  supplierName: "华强北电子",
  contactName: "李经理",
  currency: "CNY",
  lines: [
    { lineNo: 1, mpn: "STM32F103C8T6", qty: "1000", requestDate: "2026-12-01" },
    { lineNo: 2, mpn: null, qty: "500", requestDate: null },
  ],
  attachments: ["PO-2026-001 明细.xlsx"],
  sellerName: "乾创电子(苏州)",
};

describe("buildPoDispatchDraft", () => {
  it("含单号、币种、逐行明细与需求日期", () => {
    const d = buildPoDispatchDraft(PO);
    expect(d.subject).toContain("PO-2026-001");
    expect(d.body).toContain("STM32F103C8T6 × 1000");
    expect(d.body).toContain("2026-12-01");
  });

  it("缺 MPN / 缺日期时如实标注,不留空也不编", () => {
    const d = buildPoDispatchDraft(PO);
    expect(d.body).toContain("(未填 MPN)");
    expect(d.body).toContain("需求日期 待定");
  });

  it("**措辞里不得出现任何已发送的暗示**", () => {
    const d = buildPoDispatchDraft(PO);
    const all = `${d.subject}\n${d.body}\n${d.deliveryNote}`;
    expect(all).not.toContain("已发送");
    expect(all).not.toContain("已寄出");
    expect(d.deliveryNote).toContain("系统不会自动发送");
  });

  it("空行项不抛错,给出可读占位", () => {
    const d = buildPoDispatchDraft({ ...PO, lines: [] });
    expect(d.body).toContain("(无行项)");
  });

  it("纯函数:同样输入得到同样正文", () => {
    expect(buildPoDispatchDraft(PO).body).toBe(buildPoDispatchDraft(PO).body);
  });
});

describe("buildSupplierOnboardDraft", () => {
  it("含邀请链接与有效期", () => {
    const d = buildSupplierOnboardDraft({
      companyName: "某某电子",
      inviteUrl: "https://example.com/onboard/abc",
      expiresAt: "2026-08-30",
      sellerName: "乾创电子(苏州)",
    });
    expect(d.body).toContain("https://example.com/onboard/abc");
    expect(d.body).toContain("2026-08-30");
    // 复核前不进主数据 —— 这句必须在
    expect(d.body).toContain("不会进入正式主数据");
  });

  it("无有效期时给出兜底说明而不是留空", () => {
    const d = buildSupplierOnboardDraft({
      companyName: null,
      inviteUrl: "https://x/y",
      expiresAt: null,
      sellerName: "S",
    });
    expect(d.body).toContain("如链接失效请联系我方");
  });
});

describe("draftStatusLabel", () => {
  it("**没有「已发送」这个状态**;未知状态回落草稿,不臆造完成态", () => {
    expect(draftStatusLabel("DRAFT")).toBe("草稿(未发送)");
    expect(draftStatusLabel("PREVIEWED")).toBe("已预览(未发送)");
    expect(draftStatusLabel("SENT")).toBe("草稿(未发送)");
    expect(draftStatusLabel("随便什么")).toBe("草稿(未发送)");
  });
});
