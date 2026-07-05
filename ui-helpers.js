/* ============================================================
 * ezPLM UI 助手模块 (ui-helpers.js)
 * 功能:
 *   1. 全局按钮点击兜底(无 onclick 的按钮自动给 Toast 提示)
 *   2. 通用 Modal:导出 / 筛选 / 更多操作 / 查看权限
 *   3. 简单分页交互
 *   4. 表格行 ⋯ 更多操作菜单
 * ============================================================ */
(function () {
  'use strict';

  // ============ 工具:轻量 Toast(若无 workflow.js)============
  function ezToast(text, type = 'info') {
    if (window.Workflow && window.Workflow.showToast) {
      window.Workflow.showToast(text, type);
      return;
    }
    // 内置 fallback
    let el = document.getElementById('ez-toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ez-toast-container';
      el.style.cssText = 'position:fixed; bottom:30px; right:30px; z-index:99999; display:flex; flex-direction:column; gap:8px;';
      document.body.appendChild(el);
    }
    const t = document.createElement('div');
    const colorMap = { info: '#0891b2', success: '#16a34a', warning: '#d97706', danger: '#dc2626' };
    t.style.cssText = `
      background:white; padding:12px 18px; border-radius:10px;
      box-shadow:0 4px 18px rgba(0,0,0,0.12);
      border-left:4px solid ${colorMap[type] || '#0891b2'};
      font-size:13px; color:#18181b; font-weight:500;
      transform:translateX(120%); transition:all 320ms cubic-bezier(0.16,1,0.3,1);
      max-width:380px;
    `;
    t.textContent = text;
    el.appendChild(t);
    requestAnimationFrame(() => { t.style.transform = 'translateX(0)'; });
    setTimeout(() => {
      t.style.transform = 'translateX(120%)';
      setTimeout(() => t.remove(), 320);
    }, 2800);
  }

  // ============ 通用 Modal ============
  function showModal(opts) {
    closeAllModals();
    const { title, subtitle, content, footer, width, icon, accent } = opts;
    const overlay = document.createElement('div');
    overlay.className = 'ez-modal-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(15,23,42,0.5);
      backdrop-filter:blur(4px); z-index:10001;
      display:flex; align-items:center; justify-content:center;
      padding:24px; opacity:0; transition:opacity 280ms;
    `;
    const accentColor = accent || '#7B61FF';
    overlay.innerHTML = `
      <div class="ez-modal-panel" style="
        width:${width || 640}px; max-width:calc(100vw - 48px);
        max-height:calc(100vh - 48px); background:white;
        border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,0.25);
        display:flex; flex-direction:column;
        transform:translateY(12px) scale(0.97); transition:all 280ms cubic-bezier(0.16,1,0.3,1);
      ">
        <div style="padding:16px 22px; background:linear-gradient(135deg, ${accentColor} 0%, ${accentColor}dd 100%); color:white; border-radius:14px 14px 0 0; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:32px; height:32px; background:rgba(255,255,255,0.18); border-radius:8px; display:grid; place-items:center; font-size:16px;">${icon || '✦'}</div>
            <div>
              <div style="font-size:15px; font-weight:600; color:white;">${title}</div>
              ${subtitle ? `<div style="font-size:11px; color:rgba(255,255,255,0.78); margin-top:2px;">${subtitle}</div>` : ''}
            </div>
          </div>
          <button onclick="window.ezUI.closeAllModals()" style="background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.2); border-radius:6px; width:28px; height:28px; color:white; cursor:pointer; display:grid; place-items:center;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="flex:1; overflow-y:auto; padding:20px 22px; font-size:13px; color:#27272a; line-height:1.6;">
          ${content}
        </div>
        ${footer ? `<div style="padding:12px 22px; border-top:1px solid #f4f4f5; background:#fafafa; border-radius:0 0 14px 14px; display:flex; align-items:center; justify-content:flex-end; gap:8px;">${footer}</div>` : ''}
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAllModals(); });
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      const p = overlay.querySelector('.ez-modal-panel');
      if (p) p.style.transform = 'translateY(0) scale(1)';
    });
    return overlay;
  }

  function closeAllModals() {
    document.querySelectorAll('.ez-modal-overlay').forEach(o => {
      o.style.opacity = '0';
      const p = o.querySelector('.ez-modal-panel');
      if (p) p.style.transform = 'translateY(12px) scale(0.97)';
      setTimeout(() => o.remove(), 280);
    });
    // 也关闭 popover
    document.querySelectorAll('.ez-popover').forEach(p => p.remove());
  }

  // ============ 通用筛选 Modal ============
  function showFilterModal() {
    showModal({
      title: '筛选',
      subtitle: '设置筛选条件后应用',
      icon: '🔍',
      accent: '#0891b2',
      width: 560,
      content: `
        <div style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label style="font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">日期范围</label>
            <div style="display:flex; gap:8px; margin-top:4px;">
              <input type="date" value="2026-05-01" style="flex:1; padding:8px 10px; border:1px solid #e4e4e7; border-radius:6px; font-size:13px; font-family:JetBrains Mono;" />
              <span style="align-self:center; color:#a1a1aa;">至</span>
              <input type="date" value="2026-05-28" style="flex:1; padding:8px 10px; border:1px solid #e4e4e7; border-radius:6px; font-size:13px; font-family:JetBrains Mono;" />
            </div>
          </div>
          <div>
            <label style="font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">状态</label>
            <div style="display:flex; gap:6px; margin-top:4px; flex-wrap:wrap;">
              <label style="display:flex; align-items:center; gap:4px; padding:6px 12px; background:#f4f4f5; border-radius:18px; cursor:pointer; font-size:12px;"><input type="checkbox" checked style="accent-color:#7B61FF;"/> 进行中</label>
              <label style="display:flex; align-items:center; gap:4px; padding:6px 12px; background:#f4f4f5; border-radius:18px; cursor:pointer; font-size:12px;"><input type="checkbox" checked style="accent-color:#7B61FF;"/> 已完成</label>
              <label style="display:flex; align-items:center; gap:4px; padding:6px 12px; background:#f4f4f5; border-radius:18px; cursor:pointer; font-size:12px;"><input type="checkbox" style="accent-color:#7B61FF;"/> 已退回</label>
              <label style="display:flex; align-items:center; gap:4px; padding:6px 12px; background:#f4f4f5; border-radius:18px; cursor:pointer; font-size:12px;"><input type="checkbox" style="accent-color:#7B61FF;"/> 草稿</label>
            </div>
          </div>
          <div>
            <label style="font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">负责人</label>
            <select style="width:100%; padding:8px 10px; border:1px solid #e4e4e7; border-radius:6px; font-size:13px; margin-top:4px;">
              <option>全部</option>
              <option>王 工 / PM</option>
              <option>李 工 / 工程师</option>
              <option>孙 QE / 质量经理</option>
              <option>周 销售 / 销售经理</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">客户/项目</label>
            <select style="width:100%; padding:8px 10px; border:1px solid #e4e4e7; border-radius:6px; font-size:13px; margin-top:4px;">
              <option>全部</option>
              <option>联创科技 (A 类)</option>
              <option>时代电子 (B 类)</option>
              <option>远景智造 (B 类)</option>
              <option>华星科技 (C 类)</option>
            </select>
          </div>
        </div>
      `,
      footer: `
        <button onclick="window.ezUI.closeAllModals(); window.ezUI.toast('已重置筛选条件', 'info');" style="padding:7px 14px; background:white; border:1px solid #e4e4e7; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer;">重置</button>
        <button onclick="window.ezUI.closeAllModals();" style="padding:7px 14px; background:#fafafa; border:1px solid #e4e4e7; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer;">取消</button>
        <button onclick="window.ezUI.closeAllModals(); window.ezUI.toast('✓ 已应用 3 项筛选条件', 'success');" style="padding:7px 14px; background:#0891b2; color:white; border:0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">应用筛选</button>
      `
    });
  }

  // ============ 通用导出 Modal ============
  function showExportModal(defaultName) {
    showModal({
      title: '导出',
      subtitle: '选择格式和范围',
      icon: '📥',
      accent: '#16a34a',
      width: 520,
      content: `
        <div style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label style="font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">导出格式</label>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-top:4px;">
              <label style="padding:14px 8px; background:#f0fdf4; border:1.5px solid #16a34a; border-radius:8px; cursor:pointer; text-align:center;"><input type="radio" name="fmt" checked style="display:none;"/><div style="font-size:22px;">📊</div><div style="font-size:11px; font-weight:600; color:#16a34a;">Excel</div></label>
              <label style="padding:14px 8px; background:#fef2f2; border:1.5px solid #fca5a5; border-radius:8px; cursor:pointer; text-align:center;"><input type="radio" name="fmt" style="display:none;"/><div style="font-size:22px;">📄</div><div style="font-size:11px; font-weight:600; color:#dc2626;">PDF</div></label>
              <label style="padding:14px 8px; background:#f4f4f5; border:1.5px solid #e4e4e7; border-radius:8px; cursor:pointer; text-align:center;"><input type="radio" name="fmt" style="display:none;"/><div style="font-size:22px;">📋</div><div style="font-size:11px; font-weight:600;">CSV</div></label>
            </div>
          </div>
          <div>
            <label style="font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">导出范围</label>
            <div style="display:flex; gap:6px; margin-top:4px;">
              <label style="flex:1; padding:8px 12px; background:#ede9fe; border:1px solid #c4b5fd; border-radius:6px; cursor:pointer; font-size:12px;"><input type="radio" name="scope" checked style="accent-color:#7B61FF;"/> 当前筛选结果</label>
              <label style="flex:1; padding:8px 12px; background:#f4f4f5; border:1px solid #e4e4e7; border-radius:6px; cursor:pointer; font-size:12px;"><input type="radio" name="scope" style="accent-color:#7B61FF;"/> 全部数据</label>
            </div>
          </div>
          <div>
            <label style="font-size:11px; color:#71717a; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">文件名</label>
            <input type="text" value="${defaultName || 'ezPLM-export-' + new Date().toISOString().slice(0,10)}" style="width:100%; padding:8px 10px; border:1px solid #e4e4e7; border-radius:6px; font-size:13px; margin-top:4px; font-family:JetBrains Mono;" />
          </div>
        </div>
      `,
      footer: `
        <button onclick="window.ezUI.closeAllModals();" style="padding:7px 14px; background:#fafafa; border:1px solid #e4e4e7; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer;">取消</button>
        <button onclick="window.ezUI.closeAllModals(); window.ezUI.toast('✓ 文件已生成 · 自动下载中...', 'success');" style="padding:7px 14px; background:#16a34a; color:white; border:0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">开始导出</button>
      `
    });
  }

  // ============ 行级 ⋯ 更多操作 Popover ============
  function showRowActionsMenu(anchorEl) {
    document.querySelectorAll('.ez-popover').forEach(p => p.remove());
    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'ez-popover';
    menu.style.cssText = `
      position:fixed; top:${rect.bottom + 4}px; left:${rect.right - 180}px;
      background:white; border:1px solid #e4e4e7; border-radius:10px;
      box-shadow:0 8px 24px rgba(0,0,0,0.12); padding:6px 0; z-index:10002;
      min-width:180px;
      transform:translateY(-6px); opacity:0;
      transition:all 180ms ease;
    `;
    const actions = [
      { icon: '👁', label: '查看详情', color: '' },
      { icon: '✎', label: '编辑', color: '' },
      { icon: '📋', label: '复制', color: '' },
      { icon: '📥', label: '导出', color: '' },
      { divider: true },
      { icon: '🔗', label: '复制链接', color: '' },
      { icon: '🗑', label: '删除', color: '#dc2626' },
    ];
    let html = '';
    actions.forEach(a => {
      if (a.divider) {
        html += '<div style="height:1px; background:#f4f4f5; margin:4px 0;"></div>';
      } else {
        html += `<div onclick="window.ezUI.closeAllModals(); window.ezUI.toast('${a.label}功能演示', 'info');" style="padding:8px 14px; display:flex; align-items:center; gap:10px; font-size:13px; cursor:pointer; color:${a.color || '#27272a'};" onmouseover="this.style.background='#f4f4f5';" onmouseout="this.style.background='transparent';">
          <span style="width:18px; text-align:center;">${a.icon}</span><span>${a.label}</span>
        </div>`;
      }
    });
    menu.innerHTML = html;
    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      menu.style.transform = 'translateY(0)';
      menu.style.opacity = '1';
    });
    setTimeout(() => {
      document.addEventListener('click', function once(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', once); }
      });
    }, 50);
  }

  // ============ 通用 Info Modal(查看 / 详情 / 权限等)============
  function showInfoModal(opts) {
    const { title, subtitle, items, icon, accent } = opts;
    let content = '<div style="display:flex; flex-direction:column; gap:10px;">';
    items.forEach(item => {
      content += `
        <div style="display:flex; justify-content:space-between; padding:10px 12px; background:#fafafa; border-radius:8px; font-size:13px;">
          <span style="color:#71717a;">${item.key}</span>
          <strong style="color:#18181b; font-family:${item.mono ? 'JetBrains Mono' : 'inherit'};">${item.value}</strong>
        </div>`;
    });
    content += '</div>';
    showModal({
      title: title,
      subtitle: subtitle,
      icon: icon || '👁',
      accent: accent || '#7B61FF',
      content,
      footer: `<button onclick="window.ezUI.closeAllModals();" style="padding:7px 14px; background:#7B61FF; color:white; border:0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">知道了</button>`
    });
  }

  // ============ 简单分页交互 ============
  function paginate(pageNum) {
    ezToast(`已切换到第 ${pageNum} 页`, 'info');
  }

  // ============ 全局点击拦截器(核心兜底)============
  function attachGlobalClickHandler() {
    document.addEventListener('click', function(e) {
      const btn = e.target.closest('button');
      if (!btn) return;

      // 已有 onclick 不处理
      if (btn.hasAttribute('onclick')) return;
      // type="submit" 但不在 form 内的:浏览器默认是 submit,需要兜底
      // type="button" 是显式声明 不处理 submit 行为,只走我们的兜底
      // 真正在 <form> 内的不处理(可能有自定义 listener)
      const inForm = btn.closest('form');
      if (inForm) return;

      // 获取按钮文本
      const text = (btn.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > 50) return;
      // 模板占位符忽略
      if (text.includes('${')) return;

      // 智能识别按钮意图
      const t = text.toLowerCase();

      // ⋯ 更多操作 - 显示菜单
      if (text === '⋯' || text === '⋮' || text === '...') {
        e.preventDefault();
        showRowActionsMenu(btn);
        return;
      }

      // ✎ 编辑
      if (text === '✎' || text === '编辑') {
        e.preventDefault();
        ezToast('已进入编辑模式', 'info');
        return;
      }

      // ⊘ 禁用 / 删除
      if (text === '⊘' || text === '禁用' || text === '撤销' || text === '删除') {
        e.preventDefault();
        if (confirm(`确认${text === '⊘' ? '禁用' : text}此项?`)) {
          ezToast(`✓ 已${text === '⊘' ? '禁用' : text}`, 'success');
        }
        return;
      }

      // 筛选
      if (t.includes('筛选') || t === 'filter') {
        e.preventDefault();
        showFilterModal();
        return;
      }

      // 导出系列
      if (t.includes('导出') || t.includes('下载')) {
        e.preventDefault();
        showExportModal();
        return;
      }

      // 导入
      if (t.includes('导入') || t.includes('上传')) {
        e.preventDefault();
        ezToast('📂 已打开文件选择对话框', 'info');
        return;
      }

      // 查看(单独)
      if (text === '查看' || text === '详情' || text === '查看详情') {
        e.preventDefault();
        ezToast('打开详情面板', 'info');
        return;
      }

      // 查看权限
      if (text === '查看权限') {
        e.preventDefault();
        showInfoModal({
          title: '角色权限详情',
          subtitle: '可执行的 24 项操作权限',
          icon: '🛡',
          items: [
            { key: 'BOM 创建', value: '✓ 允许', mono: false },
            { key: 'BOM 审批', value: '✓ 允许', mono: false },
            { key: 'ECN 发起', value: '✓ 允许', mono: false },
            { key: 'ECN 审批', value: '✓ 允许', mono: false },
            { key: '采购单 ≤ ¥50K', value: '✓ 允许', mono: false },
            { key: '采购单 > ¥100K', value: '✗ 拒绝', mono: false },
            { key: '物料新增', value: '✓ 允许', mono: false },
            { key: '系统设置', value: '✗ 拒绝', mono: false },
          ]
        });
        return;
      }

      // 联系供应商
      if (t.includes('联系供应商') || t === '联系') {
        e.preventDefault();
        ezToast('✉ 已打开供应商沟通工单', 'info');
        return;
      }

      // 选用 / 采用 / 选择
      if (text === '选用' || text === '选择' || t.includes('采用此方案')) {
        e.preventDefault();
        ezToast(`✓ 已${text}此项 · 已记入决策日志`, 'success');
        return;
      }

      // 复制
      if (text === '复制') {
        e.preventDefault();
        ezToast('📋 已复制到剪贴板', 'success');
        return;
      }

      // 分页数字按钮
      if (/^\d+$/.test(text)) {
        e.preventDefault();
        paginate(text);
        return;
      }
      if (text === '上一页' || text === '下一页') {
        e.preventDefault();
        ezToast(`已切换到${text === '上一页' ? '上' : '下'}一页`, 'info');
        return;
      }
      if (text === '…' || text === '...') {
        e.preventDefault();
        return;
      }

      // 保存草稿
      if (t.includes('保存草稿') || t.includes('保存')) {
        e.preventDefault();
        ezToast('✓ 草稿已保存', 'success');
        return;
      }

      // 提交审核 / 提交
      if (t.includes('提交审核') || t.includes('提交申请') || t === '提交') {
        e.preventDefault();
        ezToast('✓ 已提交审核 · 微信通知已推送', 'success');
        return;
      }

      // 通过 / 批准
      if (text === '通过评审' || text === '通过' || t.includes('批准')) {
        e.preventDefault();
        ezToast('✓ 已审批通过 · 流程进入下一节点', 'success');
        return;
      }

      // 退回
      if (text === '退回修改' || text === '退回') {
        e.preventDefault();
        const reason = prompt('请填写退回原因(不少于 6 个字):');
        if (reason && reason.length >= 6) {
          ezToast('已退回到上一节点 · 已通知发起人', 'warning');
        } else if (reason !== null) {
          ezToast('退回原因不能少于 6 个字', 'danger');
        }
        return;
      }

      // 新建系列
      if (t.includes('新建') || t.includes('添加') || t.startsWith('+')) {
        e.preventDefault();
        ezToast('已打开新建表单', 'info');
        return;
      }

      // 实时刷新
      if (t.includes('实时刷新') || t.includes('刷新')) {
        e.preventDefault();
        ezToast('🔄 数据已刷新', 'success');
        return;
      }

      // 起草告知函
      if (t.includes('起草') && t.includes('告知')) {
        e.preventDefault();
        if (window.location) {
          ezToast('正在跳转到客户告知函编辑器...', 'info');
          setTimeout(() => { window.location.href = 'customer-letter.html'; }, 700);
        }
        return;
      }

      // 立即冻结
      if (t.includes('冻结') || t.includes('隔离')) {
        e.preventDefault();
        if (confirm('确认立即冻结此 LOT/批次? 所有相关 WIP 将暂停。')) {
          ezToast('🔒 已冻结 · Trace Agent 已启动 6 项自动处置', 'success');
        }
        return;
      }

      // AI 相关
      if (t.startsWith('✦') || t.includes('ai ')) {
        e.preventDefault();
        ezToast('✦ AI Agent 正在处理 · 预计 3-8 秒', 'info');
        return;
      }

      // 查看历史 / 查看 PCN / 查看预测 等
      if (t.startsWith('查看')) {
        e.preventDefault();
        ezToast(`正在加载: ${text}`, 'info');
        return;
      }

      // 通用兜底
      e.preventDefault();
      ezToast(`「${text}」功能演示中`, 'info');
    }, true);  // capture 阶段
  }

  // ============ 公开 API ============
  window.ezUI = {
    toast: ezToast,
    showModal,
    closeAllModals,
    showFilterModal,
    showExportModal,
    showRowActionsMenu,
    showInfoModal,
    paginate,
  };

  // ============ 自动初始化 ============
  function init() {
    attachGlobalClickHandler();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
