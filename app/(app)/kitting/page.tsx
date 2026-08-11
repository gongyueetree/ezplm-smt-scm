import { redirect } from "next/navigation";

/**
 * S-5(客户 PR2 反馈 采购-11:「缺料分析和齐料检查内容似乎重复,齐套分析合并到缺料分析中即可」)。
 *
 * 核实结论:**确实重复**。两页的入参完全一样(`v` / `boards` / `scrap`),
 * 都调 `buildKittingReport` 按 BOM 版本 + 投产数 + 损耗率算同一份报告 ——
 * 「工单齐料」只是措辞,数据源并不是工单。区别仅在于显示了哪几列。
 * 现在列已按客户要求并入 /shortage(补 PN / 库存 / 在途)。
 *
 * 这里**保留路由做重定向而不是删除**:客户可能存了书签,直接删会 404;
 * 查询参数原样带过去,书签里的具体 BOM 版本仍然打得开。
 */
export const dynamic = "force-dynamic";

export default async function KittingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") qs.set(k, v);
  }
  const suffix = qs.toString();
  redirect(suffix ? `/shortage?${suffix}` : "/shortage");
}
