import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { badRequest, forbidden, requireSession } from "@/lib/server/api";
import { canAccessKind } from "@/lib/server/recon-access";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

/**
 * E5:对账**示例**(客户 Q11 原话:「此项功能不知如何实现,**需要举例**」)。
 *
 * 客户没说功能错,说的是不知道怎么用。所以这里不动对账引擎,
 * 只补两样东西:
 * - `GET`:下载一份**样例对账单**,照着填就能用;
 * - `POST`:一键加载示例数据,让人直接看到匹配与差异长什么样。
 *
 * 示例数据一律打 `isExample` 标记:台账上标注、可一键清除。
 * **不打标记的话,演示用的数字会混进真实对账结论里** —— 那比没有示例更糟。
 */

const AR_ROWS = [
  ["INV-2026-0001", "2026-07-05", "PCBA-A 板", "1000", "12.50", "12500.00", "CNY"],
  ["INV-2026-0002", "2026-07-12", "PCBA-B 板", "500", "23.80", "11900.00", "CNY"],
  // 数量对不上:对方 800,我方 750
  ["INV-2026-0003", "2026-07-20", "PCBA-C 板", "800", "9.90", "7920.00", "CNY"],
  // 我方没有这一张 —— 「仅对方有」
  ["INV-2026-0009", "2026-07-28", "样品费", "1", "3000.00", "3000.00", "CNY"],
];

export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const kind = new URL(req.url).searchParams.get("kind") === "AP" ? "AP" : "AR";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === "AR" ? "客户对账单示例" : "供应商对账单示例");
  ws.addRow([`${kind === "AR" ? "客户" : "供应商"}对账单(示例)`]);
  ws.addRow([`说明:把贵司/对方的对账单整理成下面这几列即可导入。列名可以是中文或英文,系统会自动识别。`]);
  ws.addRow([]);
  ws.addRow(["单据号", "日期", "摘要", "数量", "单价", "金额", "币种"]);
  for (const r of AR_ROWS) ws.addRow(r);
  ws.columns = [{ width: 18 }, { width: 14 }, { width: 20 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 8 }];

  const help = wb.addWorksheet("怎么用");
  for (const line of [
    ["第 1 步", "上传对方给的对账单(本文件就是格式样例)"],
    ["第 2 步", "系统按单据号 / 日期 / 金额自动匹配我方记录"],
    ["第 3 步", "查看差异:一致 / 数量差异 / 单价差异 / 金额差异 / 币种不一致 / 仅对方有 / 仅我方有"],
    ["第 4 步", "逐条人工确认或标注处理意见"],
    ["第 5 步", "导出差异结果给对方"],
    [],
    ["注意", "当前对账基准来自**系统已有记录 / 导入数据**;ERP AR/AP 接入后可自动同步。"],
    ["注意", "金额容差默认 0.01,是**口径**不是魔法数,可在对账单上调整。"],
  ]) {
    help.addRow(line);
  }
  help.columns = [{ width: 10 }, { width: 76 }];

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reconciliation-example-${kind}.xlsx"`,
    },
  });
}

/** 一键加载示例对账单(打 isExample 标记,不与正式数据混淆) */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const kind = new URL(req.url).searchParams.get("kind") === "AP" ? "AP" : "AR";
  if (!canAccessKind(auth.session.roles, kind)) {
    return forbidden(kind === "AR" ? "应收对账属 PM 侧" : "应付对账属采购侧");
  }

  const counterpart =
    kind === "AR"
      ? await prisma.customer.findFirst({ where: tenantWhere(auth.session.tenantId), select: { id: true } })
      : await prisma.supplier.findFirst({ where: tenantWhere(auth.session.tenantId), select: { id: true } });
  if (!counterpart) {
    return badRequest(
      kind === "AR" ? "示例需要至少一个客户,请先建客户" : "示例需要至少一个供应商,请先建供应商",
    );
  }

  const code = `示例-${kind}-${Date.now().toString(36).toUpperCase()}`;
  const stmt = await prisma.$transaction(async (tx) => {
    const s = await tx.reconciliationStatement.create({
      data: tenantData(auth.session.tenantId, {
        kind,
        code,
        customerId: kind === "AR" ? counterpart.id : null,
        supplierId: kind === "AP" ? counterpart.id : null,
        currency: "CNY",
        status: "DRAFT",
        baselineSource: "DERIVED",
        isExample: true,
        createdById: auth.session.userId,
      }),
    });
    /*
     * 示例行**直接带上双方数据与结论**,让人一眼看到四种典型情形:
     * 完全一致 / 数量差异 / 金额差异 / 仅对方有。
     * 不跑匹配引擎 —— 示例的目的是"看懂长什么样",不是演示算法。
     */
    const EXAMPLE_LINES = [
      {
        docNo: "INV-2026-0001", theirQty: "1000", theirUnitPrice: "12.50", theirAmount: "12500.00",
        ourQty: "1000", ourUnitPrice: "12.50", ourAmount: "12500.00",
        verdict: "CONSISTENT" as const, severity: "info", diffAmount: "0.00",
        note: "双方单据号、数量、单价、金额全部一致",
      },
      {
        docNo: "INV-2026-0003", theirQty: "800", theirUnitPrice: "9.90", theirAmount: "7920.00",
        ourQty: "750", ourUnitPrice: "9.90", ourAmount: "7425.00",
        verdict: "QTY_DIFF" as const, severity: "error", diffAmount: "495.00",
        note: "对方 800、我方 750 —— 差 50 个,金额随之差 495.00",
      },
      {
        docNo: "INV-2026-0002", theirQty: "500", theirUnitPrice: "23.80", theirAmount: "11900.00",
        ourQty: "500", ourUnitPrice: "23.80", ourAmount: "11880.00",
        verdict: "AMOUNT_DIFF" as const, severity: "warn", diffAmount: "20.00",
        note: "数量单价都一样,金额差 20.00 —— 多半是对方的舍入口径不同",
      },
      {
        docNo: "INV-2026-0009", theirQty: "1", theirUnitPrice: "3000.00", theirAmount: "3000.00",
        ourQty: null, ourUnitPrice: null, ourAmount: null,
        verdict: "ONLY_THEIRS" as const, severity: "error", diffAmount: null,
        note: "只有对方有这一张 —— 我方没有对应记录,需要查是不是漏开票",
      },
    ];
    await tx.reconciliationLine.createMany({
      data: EXAMPLE_LINES.map((l, i) =>
        tenantData(auth.session.tenantId, {
          statementId: s.id,
          lineNo: i + 1,
          matchKey: l.docNo,
          docNo: l.docNo,
          theirQty: l.theirQty,
          theirUnitPrice: l.theirUnitPrice,
          theirAmount: l.theirAmount,
          theirCurrency: "CNY",
          ourQty: l.ourQty,
          ourUnitPrice: l.ourUnitPrice,
          ourAmount: l.ourAmount,
          ourCurrency: l.ourQty === null ? null : "CNY",
          verdict: l.verdict,
          severity: l.severity,
          // 说明走 details(该表没有 note 字段;resolution 留空 —— 结论必须人工填)
          details: [l.note] as unknown as object,
          // 差额是**写死的示例值**,不在这里做算术 ——
          // 金额一律走 Decimal,示例也不给自己开浮点的口子
          diffAmount: l.diffAmount,
        }),
      ),
    });
    await writeAudit(tx, {
      tenantId: auth.session.tenantId,
      userId: auth.session.userId,
      action: "RECON_EXAMPLE_LOAD",
      entityType: "ReconciliationStatement",
      entityId: s.id,
      after: { kind, code, lines: 4, isExample: true },
    });
    return s;
  });

  return NextResponse.json(
    {
      statement: stmt,
      note:
        "已加载**示例**对账单 —— 台账上带「示例」标记,不计入正式对账结论,可随时删除。" +
        "接下来点进去看匹配与差异长什么样。",
    },
    { status: 201 },
  );
}
