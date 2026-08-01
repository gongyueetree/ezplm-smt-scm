import { NextResponse } from "next/server";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { requirePermission } from "@/lib/server/permissions";
import { queryTraceScoped, resolveQuery } from "@/lib/server/repositories/traceability";

export const runtime = "nodejs";

/**
 * 追溯查询:输入批次/工单/成品/出货/PO 均可,解析成节点引用后正反向遍历。
 * 查不到时明确说"未找到",**不返回空图冒充没有影响**。
 */
export async function GET(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const perm = await requirePermission(auth.session, "trace.view");
  if (!perm.ok) return perm.response;

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  const q = url.searchParams.get("q");

  let sourceRef = ref;
  if (!sourceRef) {
    if (!q) return badRequest("请提供 q(查询关键字)或 ref(节点引用)");
    const hits = await resolveQuery(auth.session, q);
    if (hits.length === 0) {
      return notFound(
        `未找到与「${q}」相关的批次数据 —— 可能是尚未导入(收料/工单用料/出货三张模板),而不是没有影响`,
      );
    }
    if (hits.length > 1) {
      return NextResponse.json({ candidates: hits, note: "命中多个对象,请选择一个继续" });
    }
    sourceRef = hits[0];
  }

  const r = await queryTraceScoped(auth.session, sourceRef);
  if (!r.ok) {
    // 措辞与"不存在"一致:不给越权者一个可以枚举别家批次号的探测器
    return NextResponse.json({ error: r.reason }, { status: 404 });
  }
  return NextResponse.json(r.result);
}
