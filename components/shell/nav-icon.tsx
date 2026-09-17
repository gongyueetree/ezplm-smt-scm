import type { IconName } from "@/lib/routes";

/** 图标路径抽取自原型 v5.2.1 的 customer-confirmation/nav-contract.js(legacy-static 已归档移出仓库,见 README) */
const ICON_PATHS: Record<IconName, string> = {
  home: '<path d="M3 11l9-8 9 8M5 9v12h14V9M9 21v-6h6v6" stroke-linecap="round" stroke-linejoin="round"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z" stroke-linejoin="round"/>',
  bom: '<path d="M3 7h18M3 12h18M3 17h18" stroke-linecap="round"/>',
  quote: '<path d="M14 3v5h5M5 3h9l5 5v13H5zM9 13h6M9 17h4" stroke-linecap="round" stroke-linejoin="round"/>',
  handshake: '<path d="M3 11l4-5h4l3 3-3 3a2 2 0 002.8 2.8L17 12l4-1M3 11v6h3l4 4 6-2M21 10v7h-3" stroke-linecap="round" stroke-linejoin="round"/>',
  cart: '<path d="M5 7h14l-1.5 9H6.5zM5 7l-1-3H2M9 21h0M17 21h0" stroke-linecap="round" stroke-linejoin="round"/>',
  scale: '<path d="M12 3v18M5 7l-3 6a3.5 3.5 0 007 0zM19 7l-3 6a3.5 3.5 0 007 0zM7 7h10M8 21h8" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3" stroke-linecap="round" stroke-linejoin="round"/>',
  alert: '<path d="M12 3l10 18H2zM12 10v4M12 18h0" stroke-linecap="round" stroke-linejoin="round"/>',
  ledger: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke-linecap="round"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke-linecap="round"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" stroke-linejoin="round"/>',
};

export function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? ICON_PATHS.box }}
    />
  );
}
