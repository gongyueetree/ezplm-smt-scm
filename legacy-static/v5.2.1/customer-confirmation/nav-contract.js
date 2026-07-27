/* ============================================================
 * ezPLM 合同范围导航 (nav-contract.js)
 * 依据《AI 驱动供应链智能协同系统开发合同》附件一
 *
 * 1. 新页面：渲染完整侧边栏到 #ez-sidebar-mount
 * 2. 既有 41 页原型：在页面渲染完成后，用本期合同菜单
 *    覆盖原侧边栏导航（保留品牌区与用户卡）
 * 3. 按页面注入“本期范围 / 超范围”横幅
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 本期合同菜单（附件一） ----------
  var NAV2 = [
    { title: '总览', items: [
      { id: 'dashboard', label: '工作台', href: 'dashboard.html', icon: 'home' },
    ]},
    { title: '基础平台', items: [
      { id: 'master-data', label: '基础数据', href: 'master-data.html', icon: 'db' },
      { id: 'integration', label: '系统集成', href: 'integration.html', icon: 'plug' },
      { id: 'settings', label: '系统管理', href: 'settings.html', icon: 'gear' },
      { id: 'delivery-acceptance', label: '交付 · 培训 · 验收', href: 'delivery-acceptance.html', icon: 'check' },
    ]},
    { title: 'BOM 与报价', items: [
      { id: 'bom-process', label: 'BOM 智能处理', href: 'bom-process.html', ai: true, icon: 'bom' },
      { id: 'quote', label: '智能报价', href: 'quote.html', ai: true, icon: 'quote' },
    ]},
    { title: '采购协同', items: [
      { id: 'material-quote', label: '物料报价与采购协同', href: 'material-quote.html', icon: 'handshake' },
      { id: 'procurement', label: '采购助手', href: 'procurement.html', ai: true, icon: 'cart' },
      { id: 'price-compare', label: '多源比价与替代料', href: 'price-compare.html', ai: true, icon: 'scale' },
      { id: 'opo', label: 'OPO 交期协同', href: 'opo.html', icon: 'clock' },
    ]},
    { title: '履约与对账', items: [
      { id: 'trace', label: '物料追溯', href: 'trace.html', ai: true, icon: 'trace' },
      { id: 'shortage', label: '缺料分析与 Call 料表', href: 'shortage.html', icon: 'alert' },
      { id: 'ar-ap', label: 'AR/AP 对账', href: 'ar-ap.html', icon: 'ledger' },
      { id: 'planning', label: '计划辅助', href: 'planning.html', icon: 'calendar' },
    ]},
    { title: '范围管理', items: [
      { id: 'phase2', label: '二期规划 / 变更需求池', href: 'phase2.html', icon: 'box' },
    ]},
  ];

  var ICONS2 = {
    home: '<path d="M3 11l9-8 9 8M5 9v12h14V9M9 21v-6h6v6" stroke-linecap="round" stroke-linejoin="round"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    plug: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0zM12 16v5" stroke-linecap="round" stroke-linejoin="round"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z" stroke-linejoin="round"/>',
    bom: '<path d="M3 7h18M3 12h18M3 17h18" stroke-linecap="round"/>',
    quote: '<path d="M14 3v5h5M5 3h9l5 5v13H5zM9 13h6M9 17h4" stroke-linecap="round" stroke-linejoin="round"/>',
    handshake: '<path d="M3 11l4-5h4l3 3-3 3a2 2 0 002.8 2.8L17 12l4-1M3 11v6h3l4 4 6-2M21 10v7h-3" stroke-linecap="round" stroke-linejoin="round"/>',
    cart: '<path d="M5 7h14l-1.5 9H6.5zM5 7l-1-3H2M9 21h0M17 21h0" stroke-linecap="round" stroke-linejoin="round"/>',
    scale: '<path d="M12 3v18M5 7l-3 6a3.5 3.5 0 007 0zM19 7l-3 6a3.5 3.5 0 007 0zM7 7h10M8 21h8" stroke-linecap="round" stroke-linejoin="round"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3" stroke-linecap="round" stroke-linejoin="round"/>',
    trace: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 7l3 3M14 7l3-2M7 17l3-3M14 17l3 2" stroke-linecap="round"/>',
    alert: '<path d="M12 3l10 18H2zM12 10v4M12 18h0" stroke-linecap="round" stroke-linejoin="round"/>',
    ledger: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke-linecap="round"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke-linecap="round"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" stroke-linejoin="round"/>',
    check: '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  function icon2(id) {
    return '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">'
      + (ICONS2[id] || ICONS2.box) + '</svg>';
  }

  var FILE = (location.pathname.split('/').pop() || 'dashboard.html');
  var PREFIX = location.pathname.indexOf('phase2-preview') !== -1 ? '../' : '';

  // 本期页面别名（客户确认版仅含合同范围页面，无超范围别名）
  var ALIAS = {
    'supplier.html': 'opo',
  };

  function activeId() {
    var base = FILE.replace('.html', '');
    if (NAV2.some(function (s) { return s.items.some(function (i) { return i.id === base; }); })) return base;
    return ALIAS[FILE] || '';
  }

  function navHTML(current) {
    return NAV2.map(function (s) {
      return '<div class="nav-section"><div class="nav-section-title">' + s.title + '</div>'
        + s.items.map(function (it) {
          return '<a href="' + PREFIX + it.href + '" class="nav-item' + (it.id === current ? ' active' : '') + '">'
            + icon2(it.icon)
            + '<span>' + it.label + '</span>'
            + (it.ai ? '<span class="ai-dot" title="AI 增强 · 人工确认闭环"></span>' : '')
            + '</a>';
        }).join('') + '</div>';
    }).join('');
  }

  function fullSidebarHTML(current) {
    return '<div class="brand"><div class="brand-logo">'
      + '<div class="brand-mark">硬</div>'
      + '<div><div class="brand-name">硬禾科技</div><div class="brand-sub">AI 供应链协同 · 本期交付</div></div>'
      + '</div></div>'
      + '<nav class="nav">' + navHTML(current) + '</nav>'
      + '<div class="user-card"><div class="user-avatar">王</div><div class="user-info">'
      + '<div class="user-name">王 工 / 乾创电子</div><div class="user-role">PM 经理 · 本期范围视图</div>'
      + '</div></div>';
  }

  // ---------- 横幅配置 ----------
  // 客户确认版不含任何超范围页面，OOS 横幅映射为空（仅本期范围）
  var OOS_PAGES = {};

  // 本期页面的范围提示
  var SCOPE_NOTES = {};

  function injectBanner() {
    var host = document.getElementById('page-content')
      || document.querySelector('.content')
      || document.querySelector('.main');
    if (!host) return;

    var el;
    if (OOS_PAGES[FILE]) {
      el = document.createElement('div');
      el.className = 'ez-scope-banner oos';
      el.innerHTML = '⚠ <b>超出本期合同范围（附件一）</b> — 本页面所示「' + OOS_PAGES[FILE]
        + '」属于 <b>二期规划 / 变更需求</b>，仅作产品方向演示，不纳入本期默认实现与验收；'
        + '纳入需另行确认范围、费用与周期。 <a href="' + PREFIX + 'phase2.html">查看变更需求池 →</a>';
    } else if (SCOPE_NOTES[FILE]) {
      el = document.createElement('div');
      el.className = 'ez-scope-banner ' + SCOPE_NOTES[FILE].type;
      el.innerHTML = SCOPE_NOTES[FILE].html;
    }
    if (el) host.insertBefore(el, host.firstChild);
  }

  function injectBannerCSS() {
    var css = '.ez-scope-banner{margin:14px 24px 0;border-radius:10px;padding:11px 14px;font-size:12px;'
      + 'line-height:1.7;border:1px solid #fde68a;background:#fffbeb;color:#92400e}'
      + '.ez-scope-banner a{text-decoration:underline;font-weight:700}'
      + '.ez-scope-banner.oos{border-color:#fecaca;background:#fef2f2;color:#991b1b}'
      + '.ez-scope-banner.ai{border-color:#d6cdff;background:#f6f4ff;color:#4a2db5}'
      + '#page-content>.ez-scope-banner,.content>.ez-scope-banner{margin:0 0 16px}';
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function injectMobileNav() {
    // 仅注入一次
    if (document.getElementById('ez-hamburger')) return;
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    // 汉堡按钮
    var burger = document.createElement('button');
    burger.id = 'ez-hamburger';
    burger.setAttribute('aria-label', '打开导航菜单');
    burger.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/></svg>';

    // 遮罩
    var overlay = document.createElement('div');
    overlay.id = 'ez-nav-overlay';

    document.body.appendChild(burger);
    document.body.appendChild(overlay);

    function openNav() { document.body.classList.add('ez-nav-open'); burger.setAttribute('aria-expanded', 'true'); }
    function closeNav() { document.body.classList.remove('ez-nav-open'); burger.setAttribute('aria-expanded', 'false'); }

    burger.addEventListener('click', function () {
      document.body.classList.contains('ez-nav-open') ? closeNav() : openNav();
    });
    overlay.addEventListener('click', closeNav);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
    // 点击侧栏内任一菜单项后关闭抽屉
    sidebar.addEventListener('click', function (e) {
      if (e.target.closest('.nav-item')) closeNav();
    });
  }

  function injectMobileCSS() {
    if (document.getElementById('ez-mobile-css')) return;
    var css =
      '#ez-hamburger{display:none;position:fixed;top:14px;left:14px;z-index:1002;'
      + 'width:42px;height:42px;border:1px solid var(--gray-200,#e5e7eb);border-radius:10px;'
      + 'background:#fff;color:#111;align-items:center;justify-content:center;cursor:pointer;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.08)}'
      + '#ez-nav-overlay{display:none;position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.45)}'
      + '@media(max-width:1024px){'
      + '#ez-hamburger{display:flex}'
      + '.sidebar{position:fixed;left:0;top:0;bottom:0;z-index:1001;'
      + 'transform:translateX(-100%);transition:transform .25s ease;box-shadow:2px 0 16px rgba(0,0,0,.18)}'
      + 'body.ez-nav-open .sidebar{transform:translateX(0)}'
      + 'body.ez-nav-open #ez-nav-overlay{display:block}'
      + '.main,.content{margin-left:0!important}'
      + '.topbar{padding-left:64px}'
      + '}';
    var s = document.createElement('style');
    s.id = 'ez-mobile-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function apply() {
    injectBannerCSS();
    injectMobileCSS();
    var current = activeId();
    var mount = document.getElementById('ez-sidebar-mount');
    if (mount) {
      mount.innerHTML = fullSidebarHTML(current);
    } else {
      // 旧页面：覆盖既有侧边栏的导航区
      var nav = document.querySelector('.sidebar .nav') || document.querySelector('.sidebar nav');
      if (nav) nav.innerHTML = navHTML(current);
      var sub = document.querySelector('.sidebar .brand-sub');
      if (sub) sub.textContent = 'AI 供应链协同 · 本期交付';
    }
    injectBanner();
    injectMobileNav();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
