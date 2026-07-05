/* ============================================================
 * ezPLM i18n 多语言模块
 * 用法: <script src="i18n.js"></script>
 *      window.i18n.t('key')         // 翻译
 *      window.i18n.setLang('en')    // 切换语言
 * ============================================================ */
(function () {
  'use strict';

  const TRANSLATIONS = {
    zh: {
      // 通用
      'app.brand': '硬禾科技',
      'app.brand_sub': 'ezPLM 协同平台',
      'lang.zh': '简体中文',
      'lang.en': 'English',
      'lang.switcher_title': '语言 / Language',

      // 导航分组
      'nav.engineering': '工程数据',
      'nav.supply_chain': '供应链',
      'nav.trace': '追溯与协同',
      'nav.trader': '贸易商工作台',
      'nav.system': '系统',

      // 模块名
      'mod.bom': 'BOM 管理',
      'mod.ecn': 'ECN 工程变更',
      'mod.material': '物料与规格',
      'mod.procurement': '采购与供应商',
      'mod.quote': '报价与客户',
      'mod.trace': '批次级追溯',
      'mod.supplier': '供应商门户',
      'mod.workflow_metrics': '流程指标看板',
      'mod.settings': '系统设置',

      // 通用动作
      'action.approve': '通过',
      'action.reject': '退回',
      'action.cancel': '取消',
      'action.save': '保存',
      'action.delete': '删除',
      'action.edit': '编辑',
      'action.export': '导出',
      'action.import': '导入',
      'action.new': '新建',
      'action.search': '搜索',
      'action.filter': '筛选',
      'action.close': '关闭',
      'action.refresh': '刷新',

      // 审批
      'wf.title': '审批流程',
      'wf.history': '审批历史',
      'wf.in_progress': '进行中',
      'wf.completed': '已完成',
      'wf.pending': '待开始',
      'wf.rejected': '已退回',
      'wf.my_todos': '我的待办',

      // 角色
      'role.admin': '系统管理员',
      'role.pm': '产品经理',
      'role.engineer': '工程师',
      'role.procmgr': '采购经理',
      'role.buyer': '采购员',
      'role.qe': '质量经理',
      'role.sales': '销售经理',
      'role.viewer': '只读查看者',

      // Settings 页 Tab
      'settings.tab_users': '用户管理',
      'settings.tab_roles': '角色与权限',
      'settings.tab_workflow': '审批流配置',
      'settings.tab_org': '组织架构',
      'settings.tab_delegation': '审批委托',

      // 指标看板
      'metrics.title': '流程指标看板',
      'metrics.this_month': '本月流程',
      'metrics.ai_approval_rate': 'AI 通过率',
      'metrics.avg_duration': '平均时长',
      'metrics.overdue': '超期未决',
      'metrics.type_distribution': '流程类型分布',
      'metrics.monthly_trend': '月度趋势',
      'metrics.bottleneck': '瓶颈节点 TOP 5',
      'metrics.health': '健康度指标',
      'metrics.ai_suggestions': 'AI 流程性能优化建议',
    },

    en: {
      'app.brand': 'Hardneng Tech',
      'app.brand_sub': 'ezPLM Platform',
      'lang.zh': '简体中文',
      'lang.en': 'English',
      'lang.switcher_title': '语言 / Language',

      'nav.engineering': 'Engineering',
      'nav.supply_chain': 'Supply Chain',
      'nav.trace': 'Traceability',
      'nav.trader': 'Trader Workspace',
      'nav.system': 'System',

      'mod.bom': 'BOM Mgmt',
      'mod.ecn': 'ECN Change',
      'mod.material': 'Material & Spec',
      'mod.procurement': 'Procurement',
      'mod.quote': 'Quote & Customer',
      'mod.trace': 'Batch Trace',
      'mod.supplier': 'Supplier Portal',
      'mod.workflow_metrics': 'Workflow Metrics',
      'mod.settings': 'Settings',

      'action.approve': 'Approve',
      'action.reject': 'Reject',
      'action.cancel': 'Cancel',
      'action.save': 'Save',
      'action.delete': 'Delete',
      'action.edit': 'Edit',
      'action.export': 'Export',
      'action.import': 'Import',
      'action.new': 'New',
      'action.search': 'Search',
      'action.filter': 'Filter',
      'action.close': 'Close',
      'action.refresh': 'Refresh',

      'wf.title': 'Approval Workflow',
      'wf.history': 'Approval History',
      'wf.in_progress': 'In Progress',
      'wf.completed': 'Completed',
      'wf.pending': 'Pending',
      'wf.rejected': 'Rejected',
      'wf.my_todos': 'My Todos',

      'role.admin': 'Administrator',
      'role.pm': 'Product Manager',
      'role.engineer': 'Engineer',
      'role.procmgr': 'Procurement Manager',
      'role.buyer': 'Buyer',
      'role.qe': 'Quality Engineer',
      'role.sales': 'Sales Manager',
      'role.viewer': 'Read-only Viewer',

      'settings.tab_users': 'Users',
      'settings.tab_roles': 'Roles & Permissions',
      'settings.tab_workflow': 'Workflow Templates',
      'settings.tab_org': 'Organization',
      'settings.tab_delegation': 'Delegation',

      'metrics.title': 'Workflow Metrics Dashboard',
      'metrics.this_month': 'This Month',
      'metrics.ai_approval_rate': 'AI Approval Rate',
      'metrics.avg_duration': 'Avg Duration',
      'metrics.overdue': 'Overdue',
      'metrics.type_distribution': 'Process Type Distribution',
      'metrics.monthly_trend': 'Monthly Trend',
      'metrics.bottleneck': 'Bottleneck TOP 5',
      'metrics.health': 'Health Metrics',
      'metrics.ai_suggestions': 'AI Performance Optimization Suggestions',
    },
  };

  const STORAGE_KEY = 'ezplm-lang';

  function getLang() {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'zh';
    } catch (e) {
      return 'zh';
    }
  }

  function setLang(lang) {
    if (!TRANSLATIONS[lang]) return;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    applyDOM();
  }

  function t(key, defaultVal) {
    const lang = getLang();
    return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || defaultVal || key;
  }

  // 把所有 [data-i18n="key"] 的文本替换
  function applyDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = val;
      } else {
        el.textContent = val;
      }
    });
    // 触发自定义事件,让其他模块响应语言切换
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: getLang() } }));
  }

  // 注入语言切换器到顶部用户菜单
  function injectLangSwitcher() {
    // 在 rbac.js 注入的菜单中加入语言项
    const observer = new MutationObserver(() => {
      const menu = document.getElementById('rbac-user-menu');
      if (menu && !menu.querySelector('.lang-switcher')) {
        const lang = getLang();
        const langHtml = `
          <div class="lang-switcher" style="border-top:1px solid var(--gray-100, #f4f4f5); margin-top:4px; padding-top:6px;">
            <div style="padding:6px 12px; font-size:10px; color:var(--gray-500, #71717a); font-weight:600; text-transform:uppercase; letter-spacing:0.4px;">${t('lang.switcher_title')}</div>
            <div style="display:flex; gap:4px; padding:0 8px 6px;">
              <button onclick="window.i18n.setLang('zh'); document.getElementById('rbac-user-menu').remove();" style="flex:1; padding:6px 8px; background:${lang === 'zh' ? 'var(--ai)' : 'white'}; color:${lang === 'zh' ? 'white' : 'var(--gray-700)'}; border:1px solid ${lang === 'zh' ? 'var(--ai)' : 'var(--gray-200)'}; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">🇨🇳 ${t('lang.zh')}</button>
              <button onclick="window.i18n.setLang('en'); document.getElementById('rbac-user-menu').remove();" style="flex:1; padding:6px 8px; background:${lang === 'en' ? 'var(--ai)' : 'white'}; color:${lang === 'en' ? 'white' : 'var(--gray-700)'}; border:1px solid ${lang === 'en' ? 'var(--ai)' : 'var(--gray-200)'}; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">🇺🇸 ${t('lang.en')}</button>
            </div>
          </div>
        `;
        menu.insertAdjacentHTML('beforeend', langHtml);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 公开 API
  window.i18n = {
    t, setLang, getLang, applyDOM, TRANSLATIONS
  };

  // 自动初始化
  function init() {
    document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
    applyDOM();
    injectLangSwitcher();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
