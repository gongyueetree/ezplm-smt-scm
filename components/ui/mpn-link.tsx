import Link from "next/link";

/**
 * 物料型号链接:系统内**任何**出现 MPN 的地方都用它,
 * 点击进入物料详情(基本信息 / 规格参数 / 库文件与数据手册 / 替代料)。
 * 无 MPN 时降级为纯文本,不产生死链。
 */
export function MpnLink({
  mpn,
  className = "mono",
  fallback = "-",
}: {
  mpn: string | null | undefined;
  className?: string;
  fallback?: string;
}) {
  if (!mpn || !mpn.trim()) return <span className="muted">{fallback}</span>;
  return (
    <Link
      href={`/materials/${encodeURIComponent(mpn.trim())}`}
      className={`mpn-link ${className}`}
      title={`查看 ${mpn} 的物料详情`}
    >
      {mpn}
    </Link>
  );
}
