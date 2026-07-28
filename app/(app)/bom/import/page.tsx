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
          支持 <b>CSV / XLSX 多文件</b> 导入,原始文件一律归档保存。
          <b>图片 / PDF 仅归档,不做自动识别</b> —— OCR 属二期范围,需人工补录为 CSV/XLSX 后再导入。
          唯一 MPN 超过 50 个时自动走分批作业(每批 10–20),导入请求本身不做匹配。
        </span>
      </Banner>
      <ImportWizard rfqs={rfqs} />
    </div>
  );
}
