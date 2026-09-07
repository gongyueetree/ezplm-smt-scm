import { requirePortalPage } from "../require";

export const dynamic = "force-dynamic";

/** F6-B:占位页 —— 数据源未接入,只有空态,不造数 */
export default async function PortalPage() {
  await requirePortalPage();
  return (
    <div>
      <h1 style={{ fontSize: 20 }}>出入流水</h1>
      <p data-testid="portal-transactions-empty" style={{ color: "#888" }}>
        数据源待接入 —— 接入后此处显示贵司相关记录;当前不显示任何示例数据。
      </p>
    </div>
  );
}
