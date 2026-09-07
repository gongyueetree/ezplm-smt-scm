import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { bulkConfirmHighConfidence } from "@/lib/server/repositories/bom-detail";
import { getTenantSettings } from "@/lib/server/tenant-settings";

export const runtime = "nodejs";

const Input = z.object({
  /** 前端勾选的行(可逐条取消);资格以服务端复核为准 */
  lineIds: z.array(z.string()).min(1).max(2000),
});

/**
 * F7:「一键确认高置信匹配」。
 *
 * 不是新逻辑 —— 逐行走既有 saveLineDecision(草稿料守卫在内),
 * 阈值取租户配置 matchConfidenceThreshold;相似度来源的候选**永不批量确认**。
 * 结果如实返回 confirmed/skipped(含每行原因),外加一条批量 AuditLog。
 */
export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { versionId } = await params;

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("参数不合法", { issues: parsed.error.issues });

  const { settings } = await getTenantSettings(auth.session.tenantId);
  const result = await bulkConfirmHighConfidence(
    auth.session,
    versionId,
    parsed.data.lineIds,
    settings.matchConfidenceThreshold,
  );
  if (!result) return notFound("版本不存在或不属于当前租户");
  return NextResponse.json({ ...result, threshold: settings.matchConfidenceThreshold });
}
