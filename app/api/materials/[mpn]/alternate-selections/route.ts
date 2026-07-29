import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/server/api";
import {
  listAlternateSelections,
  removeAlternateSelection,
  saveAlternateSelection,
} from "@/lib/server/repositories/alternate-selection";

export const runtime = "nodejs";

/** 行情快照:只存展示需要的字段,不透传外部原始响应 */
const MarketSchema = z.object({
  tiers: z.array(
    z.object({
      qty: z.number(),
      unitPrice: z.string(),
      currency: z.string(),
      provider: z.string(),
    }),
  ),
  availability: z.enum(["充足", "一般", "紧张", "无现货", "未知"]),
  totalStock: z.number().nullable(),
  channels: z.array(z.string()),
  dataUpdatedAt: z.string().nullable(),
  mixedCurrency: z.boolean(),
});

const SaveSchema = z.object({
  alternateMpn: z.string().trim().min(1).max(100),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  mode: z.string().trim().min(1).max(40),
  technical: z.number().int().min(0).max(100),
  evidence: z.number().int().min(0).max(100),
  sourceTrust: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  market: MarketSchema.nullish(),
  note: z.string().trim().max(500).nullable().optional(),
});

/**
 * 替代料候选清单(人工勾选的结果)。
 *
 * 语义:**待工程确认的候选**,不是已成立的替代关系 ——
 * 正式替代关系走 PartAlternate / AVL 规则,需另行审批。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  if (!mpn) return badRequest("缺少 MPN");
  return NextResponse.json({ selections: await listAlternateSelections(auth.session, mpn) });
}

export async function POST(req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  if (!mpn) return badRequest("缺少 MPN");

  const parsed = SaveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("请求参数不合法");
  if (parsed.data.alternateMpn.toUpperCase() === mpn.toUpperCase()) {
    return badRequest("不能把自己勾选为自己的替代料");
  }

  const saved = await saveAlternateSelection(auth.session, mpn, parsed.data);
  return NextResponse.json({ selection: saved }, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  const alternateMpn = new URL(req.url).searchParams.get("alternateMpn")?.trim();
  if (!mpn || !alternateMpn) return badRequest("缺少 MPN 或 alternateMpn");

  const removed = await removeAlternateSelection(auth.session, mpn, alternateMpn);
  return NextResponse.json({ removed });
}
