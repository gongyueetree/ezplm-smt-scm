import { RfqStatus } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/server/db";
import { getSession } from "@/lib/server/session";
import { tenantWhere } from "@/lib/server/tenant-scope";
import { ImportWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function BomImportPage() {
  const session = (await getSession())!;
  const rfqs = await prisma.rFQ.findMany({
    where: tenantWhere(session.tenantId, {
      status: { notIn: [RfqStatus.CLOSED_NO_QUOTE, RfqStatus.LOST] },
    }),
    orderBy: { createdAt: "desc" },
    select: { id: true, code: true, title: true },
    take: 50,
  });

  return (
    <div>
      <PageHeader path="/bom/import" />
      <Banner tone="soft">
        <span>
          支持 <b>CSV / XLSX / PDF / 图片</b> 多文件导入,原始文件一律归档保存。
          <b>PDF 有文本层时按坐标确定性重建表格</b>(不动用模型);
          <b>图片与扫描件 PDF 走模型转写,结果是草稿</b> —— 识别不保证准确,
          列映射与每一行都必须人工核对后才可采用,数量/单价一律由系统重新解析,模型不参与计算。
          唯一 MPN 超过 50 个时自动走分批作业(每批 10–20),导入请求本身不做匹配。
        </span>
      </Banner>
      <ImportWizard rfqs={rfqs} />
    </div>
  );
}
