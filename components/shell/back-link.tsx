import Link from "next/link";

/** 返回上一层按钮(SPEC §2:所有详情页和子页面必须有) */
export function BackLink({ href, label }: { href: string; label?: string }) {
  return (
    <Link href={href} className="back-link">
      <span aria-hidden>←</span> 返回{label ? ` ${label}` : "上一层"}
    </Link>
  );
}
