/* ============================================================
 * ezPLM RBAC 角色权限模块
 * 在所有页面引入: <script src="rbac.js"></script>
 * ============================================================ */
(function () {
  'use strict';

  // ============ 8 个角色定义 ============
  const ROLES = {
    admin:    { name: '系统管理员', short: '管理员',  color: '#dc2626', avatar: '管' },
    pm:       { name: '产品经理',   short: 'PM',     color: '#7B61FF', avatar: '王' },
    engineer: { name: '工程师',     short: '工程师',  color: '#3b82f6', avatar: '李' },
    procmgr:  { name: '采购经理',   short: '采购经理', color: '#f59e0b', avatar: '赵' },
    buyer:    { name: '采购员',     short: '采购员',  color: '#fb923c', avatar: '钱' },
    qe:       { name: '质量经理',   short: 'QE',     color: '#16a34a', avatar: '孙' },
    sales:    { name: '销售经理',   short: '销售',    color: '#0891b2', avatar: '周' },
    viewer:   { name: '只读查看者', short: '查看',    color: '#71717a', avatar: '吴' },
  };

  // ============ 用户模拟数据（与 8 个角色对应）============
  const USERS = {
    admin:    { id: 'u001', name: '系统管理员', email: 'admin@hardneng.com',     dept: 'IT 运维', roleId: 'admin' },
    pm:       { id: 'u002', name: '王 工',     email: 'wang@hardneng.com',      dept: '产品部', roleId: 'pm' },
    engineer: { id: 'u003', name: '李 工',     email: 'li@hardneng.com',        dept: '研发部', roleId: 'engineer' },
    procmgr:  { id: 'u004', name: '赵 经理',   email: 'zhao@hardneng.com',      dept: '采购部', roleId: 'procmgr' },
    buyer:    { id: 'u005', name: '钱 采购',   email: 'qian@hardneng.com',      dept: '采购部', roleId: 'buyer' },
    qe:       { id: 'u006', name: '孙 QE',    email: 'sun@hardneng.com',       dept: '质量部', roleId: 'qe' },
    sales:    { id: 'u007', name: '周 经理',   email: 'zhou@hardneng.com',      dept: '销售部', roleId: 'sales' },
    viewer:   { id: 'u008', name: '吴 主管',   email: 'wu@hardneng.com',        dept: '管理层', roleId: 'viewer' },
  };

  // ============ 权限矩阵 ============
  // 模块访问权限
  const MODULE_PERMS = {
    'bom':                 ['admin', 'pm', 'engineer', 'procmgr', 'qe', 'sales', 'viewer'],
    'ecn':                 ['admin', 'pm', 'engineer', 'qe', 'viewer'],
    'material':            ['admin', 'pm', 'engineer', 'procmgr', 'buyer', 'qe', 'viewer'],
    'procurement':         ['admin', 'procmgr', 'buyer', 'viewer'],
    'quote':               ['admin', 'sales', 'pm', 'viewer'],
    'trace':               ['admin', 'pm', 'engineer', 'qe', 'viewer'],
    'supplier':            ['admin', 'procmgr', 'buyer'],
    'trader':              ['admin', 'sales', 'viewer'],
    'trader-sourcing':     ['admin', 'sales'],
    'trader-quote':        ['admin', 'sales'],
    'trader-customer':     ['admin', 'sales'],
    'settings':            ['admin'],
  };

  // 操作权限
  const ACTION_PERMS = {
    // BOM 操作
    'bom.create':              ['admin', 'pm', 'engineer'],
    'bom.edit':                ['admin', 'pm', 'engineer'],
    'bom.delete':              ['admin'],
    'bom.approve':             ['admin', 'pm', 'qe'],
    'bom.export':              ['admin', 'pm', 'engineer', 'procmgr', 'qe', 'sales'],

    // ECN 操作
    'ecn.create':              ['admin', 'pm', 'engineer'],
    'ecn.approve.engineering': ['admin', 'engineer'],
    'ecn.approve.quality':     ['admin', 'qe'],
    'ecn.approve.procurement': ['admin', 'procmgr'],
    'ecn.approve.pm':          ['admin', 'pm'],
    'ecn.approve.director':    ['admin'],
    'ecn.send_customer_letter':['admin', 'pm', 'sales'],

    // 物料操作
    'material.create':         ['admin', 'pm', 'engineer'],
    'material.edit':           ['admin', 'pm', 'engineer'],
    'material.delete':         ['admin'],
    'material.erp_sync':       ['admin', 'pm', 'procmgr'],
    'material.import':         ['admin', 'pm', 'engineer', 'procmgr'],

    // 采购操作
    'procurement.create':      ['admin', 'procmgr', 'buyer'],
    'procurement.approve.50k': ['admin', 'procmgr'],
    'procurement.approve.100k':['admin', 'procmgr'],
    'procurement.approve.500k':['admin'],

    // 系统设置
    'settings.user_manage':    ['admin'],
    'settings.role_config':    ['admin'],
    'settings.workflow_config':['admin'],
  };

  // ============ 当前用户状态管理 ============
  const STORAGE_KEY = 'ezplm-current-role';

  function getCurrentRoleId() {
    try {
      const r = localStorage.getItem(STORAGE_KEY);
      if (r && ROLES[r]) return r;
    } catch (e) {}
    return 'pm'; // 默认 PM
  }

  function setCurrentRoleId(roleId) {
    try {
      localStorage.setItem(STORAGE_KEY, roleId);
    } catch (e) {}
  }

  function getCurrentUser() {
    const roleId = getCurrentRoleId();
    return USERS[roleId] || USERS.pm;
  }

  function getCurrentRole() {
    const roleId = getCurrentRoleId();
    return ROLES[roleId] || ROLES.pm;
  }

  // ============ 权限检查 ============
  function canAccessModule(moduleId) {
    const roleId = getCurrentRoleId();
    const allowed = MODULE_PERMS[moduleId] || [];
    return allowed.includes(roleId);
  }

  function can(actionKey) {
    const roleId = getCurrentRoleId();
    const allowed = ACTION_PERMS[actionKey] || [];
    return allowed.includes(roleId);
  }

  // ============ 待办数据（模拟）============
  // 按当前角色返回该角色的待办事项
  function getMyTodos() {
    const roleId = getCurrentRoleId();
    const all = [
      // ECN 评审待办
      { type: 'ecn', icon: '🔄', title: 'ECN-2026-0425-007 · USB 接口 EOL 替换', desc: '工程评审 · 待你审批', urgent: true, href: 'ecn-detail.html?ecn=ECN-2026-0425-007', perm: 'ecn.approve.engineering' },
      { type: 'ecn', icon: '🔄', title: 'ECN-2026-0425-007 · USB 接口 EOL 替换', desc: '品质评审 · 待你审批', urgent: true, href: 'ecn-detail.html?ecn=ECN-2026-0425-007', perm: 'ecn.approve.quality' },
      { type: 'ecn', icon: '🔄', title: 'ECN-2026-0418-005 · 指纹模块升级', desc: '客户确认中 · 你已批准,等候联创', urgent: false, href: 'ecn-detail.html?ecn=ECN-2026-0418-005', perm: 'ecn.approve.pm' },
      { type: 'ecn', icon: '⏰', title: 'ECN-2026-0220-099 · PL2303 接口转换', desc: '超期 12 天 · 待你跟进', urgent: true, href: 'ecn-detail.html?ecn=ECN-2026-0220-099', perm: 'ecn.approve.pm' },

      // BOM 审批待办
      { type: 'bom', icon: '📋', title: 'BOM-LC-2026-018 · 智能门锁主控板 V3.2', desc: '草稿提交确认 · 待你审批', urgent: false, href: 'bom-detail.html?bom=BOM-LC-2026-018', perm: 'bom.approve' },

      // 采购审批待办
      { type: 'po', icon: '💰', title: 'PO-2026-0510-012 · ¥86,400 · CH340G ×6,000', desc: '¥5-10万 · 待经理审批', urgent: true, href: 'po-detail.html', perm: 'procurement.approve.100k' },
      { type: 'po', icon: '💰', title: 'PO-2026-0509-008 · ¥320,000 · 锂电池 ×2,000', desc: '¥10万以上 · 待总监审批', urgent: true, href: 'po-detail.html', perm: 'procurement.approve.500k' },

      // 物料审批待办
      { type: 'material', icon: '📦', title: 'EE-IC-CH9102F · 新物料入库申请', desc: '工程师 李工 提交 · 待你审批', urgent: false, href: 'material-detail.html', perm: 'material.create' },
    ];
    return all.filter(t => can(t.perm));
  }

  // ============ 注入「当前用户」到 topbar ============
  function injectUserSwitcher() {
    const topbar = document.querySelector('.topbar') || document.querySelector('[id*="topbar"]') || document.querySelector('header');
    if (!topbar) return;

    const user = getCurrentUser();
    const role = getCurrentRole();
    const todos = getMyTodos();
    const urgentCount = todos.filter(t => t.urgent).length;

    // 找右侧操作区
    let actionsArea = topbar.querySelector('.topbar-right, .topbar-actions');
    if (!actionsArea) {
      // 找设置/通知按钮的容器
      const settingsBtn = topbar.querySelector('[class*="setting"], svg[class*="setting"]');
      if (settingsBtn) {
        actionsArea = settingsBtn.parentElement;
      } else {
        actionsArea = topbar;
      }
    }

    // 检查是否已注入
    if (document.getElementById('rbac-user-area')) return;

    const html = `
      <div id="rbac-user-area" style="display:inline-flex; align-items:center; gap:10px; margin-left:auto;">
        <!-- 待办铃铛 -->
        <button id="rbac-todo-btn" onclick="window.RBAC.openTodoPanel()" title="我的待办" style="position:relative; width:32px; height:32px; background:transparent; border:1px solid var(--gray-200, #e4e4e7); border-radius:8px; cursor:pointer; display:grid; place-items:center; color:var(--gray-600, #71717a); transition:all 150ms;" onmouseover="this.style.background='var(--gray-50, #fafafa)'; this.style.borderColor='var(--ai-300, #c4b5fd)';" onmouseout="this.style.background='transparent'; this.style.borderColor='var(--gray-200, #e4e4e7)';">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          ${todos.length > 0 ? `<span style="position:absolute; top:-3px; right:-3px; min-width:16px; height:16px; padding:0 4px; background:${urgentCount > 0 ? '#dc2626' : 'var(--gray-500, #71717a)'}; color:white; border-radius:8px; font-size:10px; font-weight:700; display:grid; place-items:center; border:2px solid white;">${todos.length}</span>` : ''}
        </button>

        <!-- 用户切换器 -->
        <button id="rbac-user-btn" onclick="window.RBAC.toggleUserMenu()" style="display:inline-flex; align-items:center; gap:8px; padding:5px 10px 5px 5px; background:white; border:1px solid var(--gray-200, #e4e4e7); border-radius:20px; cursor:pointer; transition:all 150ms;" onmouseover="this.style.borderColor='var(--ai-300, #c4b5fd)';" onmouseout="this.style.borderColor='var(--gray-200, #e4e4e7)';">
          <span style="width:24px; height:24px; background:${role.color}; color:white; border-radius:50%; display:grid; place-items:center; font-size:11px; font-weight:700; flex-shrink:0;">${user.name.charAt(0)}</span>
          <span style="font-size:12px; color:var(--gray-900, #18181b); font-weight:600;">${user.name}</span>
          <span style="font-size:10px; padding:1px 6px; background:${role.color}22; color:${role.color}; border-radius:8px; font-weight:600;">${role.short}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="color:var(--gray-400, #a1a1aa);"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    `;
    actionsArea.insertAdjacentHTML('beforeend', html);
  }

  // ============ 用户切换菜单 ============
  function toggleUserMenu() {
    let menu = document.getElementById('rbac-user-menu');
    if (menu) {
      menu.remove();
      return;
    }

    const currentRoleId = getCurrentRoleId();
    const items = Object.entries(ROLES).map(([rid, role]) => {
      const user = USERS[rid];
      const isActive = rid === currentRoleId;
      return `
        <div onclick="window.RBAC.switchRole('${rid}')" style="display:flex; align-items:center; gap:10px; padding:9px 12px; cursor:pointer; border-radius:6px; ${isActive ? `background: ${role.color}11;` : ''}" onmouseover="if(!${isActive}) this.style.background='var(--gray-50, #fafafa)';" onmouseout="if(!${isActive}) this.style.background='transparent';">
          <span style="width:28px; height:28px; background:${role.color}; color:white; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:700; flex-shrink:0;">${user.name.charAt(0)}</span>
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:600; color:var(--gray-900, #18181b);">${user.name}</div>
            <div style="font-size:10px; color:var(--gray-500, #71717a);">${role.name} · ${user.dept}</div>
          </div>
          ${isActive ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${role.color}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
        </div>
      `;
    }).join('');

    const menuHtml = `
      <div id="rbac-user-menu" style="position:fixed; top:54px; right:24px; width:280px; background:white; border:1px solid var(--gray-200, #e4e4e7); border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,0.12); z-index:1000; padding:6px;">
        <div style="padding:8px 12px; font-size:10px; color:var(--gray-500, #71717a); font-weight:600; text-transform:uppercase; letter-spacing:0.6px; border-bottom:1px solid var(--gray-100, #f4f4f5); margin-bottom:4px;">
          切换角色（演示用）
        </div>
        ${items}
        <div style="border-top:1px solid var(--gray-100, #f4f4f5); margin-top:4px; padding-top:4px;">
          <a href="settings.html" style="display:flex; align-items:center; gap:8px; padding:9px 12px; cursor:pointer; border-radius:6px; text-decoration:none; color:var(--gray-700, #3f3f46); font-size:12px;" onmouseover="this.style.background='var(--gray-50, #fafafa)';" onmouseout="this.style.background='transparent';">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            系统设置
          </a>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', menuHtml);

    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        const m = document.getElementById('rbac-user-menu');
        const btn = document.getElementById('rbac-user-btn');
        if (m && !m.contains(e.target) && btn && !btn.contains(e.target)) {
          m.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  }

  function switchRole(roleId) {
    setCurrentRoleId(roleId);
    window.location.reload();
  }

  // ============ 我的待办面板 ============
  function openTodoPanel() {
    let panel = document.getElementById('rbac-todo-panel');
    if (panel) { panel.remove(); return; }

    const todos = getMyTodos();
    const user = getCurrentUser();
    const role = getCurrentRole();

    const groupedByType = {};
    todos.forEach(t => {
      if (!groupedByType[t.type]) groupedByType[t.type] = [];
      groupedByType[t.type].push(t);
    });

    const typeNames = { ecn: 'ECN 工程变更', bom: 'BOM 审批', po: '采购订单', material: '物料审批' };

    let groupsHtml = '';
    Object.entries(groupedByType).forEach(([type, items]) => {
      groupsHtml += `
        <div style="padding:10px 14px 4px; font-size:10px; color:var(--gray-500, #71717a); font-weight:600; text-transform:uppercase; letter-spacing:0.6px;">${typeNames[type] || type}（${items.length}）</div>
      `;
      items.forEach(item => {
        groupsHtml += `
          <a href="${item.href}" style="display:flex; align-items:center; gap:10px; padding:10px 14px; text-decoration:none; color:inherit; border-bottom:1px solid var(--gray-100, #f4f4f5); transition:background 100ms;" onmouseover="this.style.background='var(--gray-50, #fafafa)';" onmouseout="this.style.background='transparent';">
            <span style="font-size:20px; line-height:1; flex-shrink:0;">${item.icon}</span>
            <div style="flex:1; min-width:0;">
              <div style="font-size:12px; font-weight:600; color:var(--gray-900, #18181b); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.title}</div>
              <div style="font-size:11px; color:${item.urgent ? '#dc2626' : 'var(--gray-500, #71717a)'};">${item.urgent ? '⚠ ' : ''}${item.desc}</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--gray-300, #d4d4d8); flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>
          </a>
        `;
      });
    });

    if (todos.length === 0) {
      groupsHtml = `
        <div style="padding:40px 20px; text-align:center; color:var(--gray-500, #71717a); font-size:12px;">
          <div style="font-size:32px; margin-bottom:8px;">🎉</div>
          <div>所有待办已处理完</div>
        </div>
      `;
    }

    const panelHtml = `
      <div id="rbac-todo-panel" style="position:fixed; top:54px; right:24px; width:360px; max-height:540px; background:white; border:1px solid var(--gray-200, #e4e4e7); border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,0.12); z-index:1000; overflow:hidden; display:flex; flex-direction:column;">
        <div style="padding:14px 16px; border-bottom:1px solid var(--gray-150, #e4e4e7); display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div style="font-size:14px; font-weight:700; color:var(--gray-900, #18181b);">我的待办</div>
            <div style="font-size:11px; color:var(--gray-500, #71717a); margin-top:2px;">${user.name} · ${role.name} · ${todos.length} 项待处理</div>
          </div>
          <button onclick="document.getElementById('rbac-todo-panel').remove()" style="width:24px; height:24px; background:transparent; border:0; cursor:pointer; color:var(--gray-400, #a1a1aa); display:grid; place-items:center; border-radius:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="flex:1; overflow-y:auto;">
          ${groupsHtml}
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', panelHtml);

    setTimeout(() => {
      document.addEventListener('click', function closePanel(e) {
        const p = document.getElementById('rbac-todo-panel');
        const btn = document.getElementById('rbac-todo-btn');
        if (p && !p.contains(e.target) && btn && !btn.contains(e.target)) {
          p.remove();
          document.removeEventListener('click', closePanel);
        }
      });
    }, 0);
  }

  // ============ 过滤侧边栏菜单 ============
  function filterSidebar() {
    const sidebar = document.querySelector('.sidebar, [class*="sidebar"]');
    if (!sidebar) return;

    // 找所有菜单项
    const navItems = sidebar.querySelectorAll('a.nav-item, .nav-item, [class*="nav-item"]');
    navItems.forEach(item => {
      // 从 href 或 data-id 提取模块名
      const href = item.getAttribute('href') || '';
      const moduleId = href.replace('.html', '').replace(/^.*\//, '');
      if (moduleId && MODULE_PERMS[moduleId]) {
        if (!canAccessModule(moduleId)) {
          item.style.display = 'none';
        }
      }
    });

    // 隐藏只剩标题没菜单项的分组
    const groups = sidebar.querySelectorAll('.nav-section, [class*="nav-section"]');
    groups.forEach(group => {
      const visibleItems = group.querySelectorAll('a.nav-item, .nav-item');
      const allHidden = Array.from(visibleItems).every(i => i.style.display === 'none');
      if (allHidden && visibleItems.length > 0) {
        group.style.display = 'none';
      }
    });
  }

  // ============ 按 data-perm 隐藏元素 ============
  function filterByPermission() {
    document.querySelectorAll('[data-perm]').forEach(el => {
      const perm = el.getAttribute('data-perm');
      if (!can(perm)) {
        el.style.display = 'none';
      }
    });
  }

  // ============ 公开 API ============
  window.RBAC = {
    ROLES,
    USERS,
    MODULE_PERMS,
    ACTION_PERMS,
    getCurrentUser,
    getCurrentRole,
    getCurrentRoleId,
    can,
    canAccessModule,
    getMyTodos,
    toggleUserMenu,
    switchRole,
    openTodoPanel,
    filterSidebar,
    filterByPermission,
  };

  // ============ 自动初始化 ============
  function init() {
    injectUserSwitcher();
    // mountChrome 可能尚未执行,延后过滤侧边栏
    setTimeout(() => {
      filterSidebar();
      filterByPermission();
    }, 50);
    // 再次保险（如果 chrome 是异步渲染的）
    setTimeout(() => {
      filterSidebar();
      filterByPermission();
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
