/* ============================================================
 * ezPLM 审批流引擎 workflow.js
 * 提供:节点渲染 + 状态机 + 按角色操作区 + 模拟通过/退回动画
 * 依赖:rbac.js
 * 使用:
 *   window.Workflow.render({
 *     containerId: 'xxx-approval-flow',
 *     actionAreaId: 'xxx-approval-action-area',
 *     templateKey: 'bom-submit',  // 流程模板
 *     instanceKey: 'BOM-LC-2026-018',  // 流程实例 ID
 *     subjectLabel: '智能门锁主控板 V3.2',  // 当前对象
 *   });
 * ============================================================ */
(function () {
  'use strict';

  // ============ 注入退回动画 CSS ============
  if (!document.getElementById('workflow-style')) {
    const style = document.createElement('style');
    style.id = 'workflow-style';
    style.textContent = `
      @keyframes rejectShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-4px); }
        75% { transform: translateX(4px); }
      }
      @keyframes nodePulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.15); }
        50% { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(245, 158, 11, 0.25); }
      }
      @keyframes arrowFlow {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 1; }
      }
      .approval-rejecting .approval-icon {
        animation: rejectShake 0.5s ease;
      }
    `;
    document.head.appendChild(style);
  }

  // ============ 流程模板定义 ============
  const TEMPLATES = {
    // ECN 工程变更评审
    'ecn-review': {
      name: 'ECN 工程变更评审',
      nodes: [
        { id: 'submit',     label: '发起人',   role: 'pm',       roleLabel: 'PM / 工程师',  perm: 'ecn.create',              icon: '○', color: '#71717a' },
        { id: 'engineering',label: '工程评审', role: 'engineer', roleLabel: '工程师',       perm: 'ecn.approve.engineering', icon: '1', color: '#3b82f6' },
        { id: 'quality',    label: '品质评审', role: 'qe',       roleLabel: 'QE',          perm: 'ecn.approve.quality',     icon: '2', color: '#16a34a' },
        { id: 'procurement',label: '采购评估', role: 'procmgr',  roleLabel: '采购经理',    perm: 'ecn.approve.procurement', icon: '3', color: '#f59e0b' },
        { id: 'pm',         label: 'PM 审批',  role: 'pm',       roleLabel: 'PM',          perm: 'ecn.approve.pm',          icon: '4', color: '#7B61FF' },
        { id: 'director',   label: '总监审批', role: 'admin',    roleLabel: '系统管理员',  perm: 'ecn.approve.director',    icon: '5', color: '#dc2626' },
        { id: 'effective',  label: '已生效',   role: null,       roleLabel: '完成',         perm: null,                      icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '3.2 天',
    },

    // BOM 提交确认
    'bom-submit': {
      name: 'BOM 提交确认',
      nodes: [
        { id: 'draft',      label: '草稿',     role: 'engineer', roleLabel: '工程师',  perm: 'bom.create',  icon: '○', color: '#71717a' },
        { id: 'submit',     label: '提交确认', role: 'engineer', roleLabel: '工程师',  perm: 'bom.create',  icon: '1', color: '#3b82f6' },
        { id: 'pm_review',  label: 'PM 审核',  role: 'pm',       roleLabel: 'PM',     perm: 'bom.approve', icon: '2', color: '#7B61FF' },
        { id: 'qe_verify',  label: 'QE 验证',  role: 'qe',       roleLabel: 'QE',     perm: 'bom.approve', icon: '3', color: '#16a34a' },
        { id: 'production', label: '量产',     role: null,       roleLabel: '完成',    perm: null,          icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '1.8 天',
    },

    // 采购订单 - 小额（¥0-50K）
    'po-small': {
      name: '采购订单 · ¥0-50K 自动通过',
      nodes: [
        { id: 'create',  label: '采购员下单', role: 'buyer', roleLabel: '采购员', perm: 'procurement.create', icon: '○', color: '#fb923c' },
        { id: 'done',    label: '自动通过',   role: null,    roleLabel: '系统自动', perm: null,                 icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '< 1 分钟',
    },

    // 采购订单 - 中额（¥50K-100K）
    'po-medium': {
      name: '采购订单 · ¥50K-100K 经理审批',
      nodes: [
        { id: 'create',     label: '采购员下单', role: 'buyer',   roleLabel: '采购员',   perm: 'procurement.create',       icon: '○', color: '#fb923c' },
        { id: 'mgr_review', label: '经理审批',   role: 'procmgr', roleLabel: '采购经理', perm: 'procurement.approve.100k', icon: '1', color: '#f59e0b' },
        { id: 'done',       label: '已通过',     role: null,      roleLabel: '完成',     perm: null,                       icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '4 小时',
    },

    // 采购订单 - 大额（¥100K+）
    'po-large': {
      name: '采购订单 · ¥100K+ 总监审批',
      nodes: [
        { id: 'create',     label: '采购员下单', role: 'buyer',   roleLabel: '采购员',   perm: 'procurement.create',       icon: '○', color: '#fb923c' },
        { id: 'mgr_review', label: '经理审批',   role: 'procmgr', roleLabel: '采购经理', perm: 'procurement.approve.100k', icon: '1', color: '#f59e0b' },
        { id: 'dir_review', label: '总监审批',   role: 'admin',   roleLabel: '总监',     perm: 'procurement.approve.500k', icon: '2', color: '#dc2626' },
        { id: 'done',       label: '已通过',     role: null,      roleLabel: '完成',     perm: null,                       icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '1 天',
    },

    // 物料新增审批
    'material-new': {
      name: '新物料入库审批',
      nodes: [
        { id: 'submit',     label: '工程师提交', role: 'engineer', roleLabel: '工程师',  perm: 'material.create', icon: '○', color: '#3b82f6' },
        { id: 'pm_classify',label: 'PM 归类',    role: 'pm',       roleLabel: 'PM',     perm: 'material.create', icon: '1', color: '#7B61FF' },
        { id: 'qe_verify',  label: 'QE 规格验证', role: 'qe',       roleLabel: 'QE',     perm: 'material.edit',   icon: '2', color: '#16a34a' },
        { id: 'in_stock',   label: '已入库',     role: null,       roleLabel: '完成',    perm: null,              icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '6 小时',
    },

    // 客户告知函流程
    'customer-letter': {
      name: '客户告知函发送',
      nodes: [
        { id: 'draft',      label: '销售起草',   role: 'sales',    roleLabel: '销售',         perm: 'ecn.send_customer_letter', icon: '○', color: '#0891b2' },
        { id: 'pm_review',  label: 'PM 审核',    role: 'pm',       roleLabel: 'PM',           perm: 'ecn.send_customer_letter', icon: '1', color: '#7B61FF' },
        { id: 'admin_seal', label: '加盖电子章', role: 'admin',    roleLabel: '管理员',       perm: 'ecn.send_customer_letter', icon: '2', color: '#dc2626' },
        { id: 'sent',       label: '已发送',     role: null,       roleLabel: '邮件已送达',   perm: null,                       icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '4 小时',
    },

    // 请假申请流程(V5)
    'leave-request': {
      name: '请假申请',
      nodes: [
        { id: 'submit',  label: '员工提交', role: 'engineer', roleLabel: '员工',     perm: 'bom.create', icon: '○', color: '#3b82f6' },
        { id: 'mgr',     label: '直属上级', role: 'pm',       roleLabel: '直属上级', perm: 'bom.approve', icon: '1', color: '#7B61FF' },
        { id: 'hr',      label: 'HR 备案',  role: 'admin',    roleLabel: 'HR/管理员', perm: 'settings.user_manage', icon: '2', color: '#16a34a' },
        { id: 'approved',label: '已批准',   role: null,       roleLabel: '自动建立委托', perm: null, icon: '✓', color: '#16a34a' },
      ],
      avgDuration: '2 小时',
    },
  };

  // ============ 流程实例状态（localStorage 持久化）============
  function getInstanceState(instanceKey, defaultIdx) {
    try {
      const raw = localStorage.getItem('ezplm-wf-' + instanceKey);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { currentNodeIdx: defaultIdx, history: [] };
  }

  function setInstanceState(instanceKey, state) {
    try {
      localStorage.setItem('ezplm-wf-' + instanceKey, JSON.stringify(state));
    } catch (e) {}
  }

  function resetInstance(instanceKey) {
    try {
      localStorage.removeItem('ezplm-wf-' + instanceKey);
    } catch (e) {}
  }

  // ============ 节点渲染 ============
  function renderNodes(container, template, currentIdx, history) {
    const nodes = template.nodes;
    let html = '';
    nodes.forEach((node, idx) => {
      const isDone = idx < currentIdx;
      const isActive = idx === currentIdx && idx < nodes.length - 1;
      const isFinal = idx === nodes.length - 1 && currentIdx >= idx;
      const status = isDone || isFinal ? 'done' : (isActive ? 'active' : 'pending');
      const histEntry = history.find(h => h.nodeIdx === idx);
      const timeText = histEntry ? formatTime(histEntry.time) : (isActive ? '进行中 · 待审' : '待开始');
      const iconBg = isDone || isFinal ? '#16a34a' : (isActive ? '#f59e0b' : '#d4d4d8');
      const iconContent = (isDone || isFinal) ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : node.icon;
      html += `
        <div class="approval-node approval-${status}" data-node-idx="${idx}" style="display:flex; flex-direction:column; align-items:center; text-align:center; flex-shrink:0; min-width:100px; position:relative;">
          <div class="approval-icon" style="width:36px; height:36px; border-radius:50%; display:grid; place-items:center; color:white; font-size:14px; font-weight:700; font-family:var(--font-mono); margin-bottom:8px; border:3px solid white; box-shadow:0 0 0 2px ${iconBg}; transition:all 200ms; background:${iconBg}; ${isActive ? 'animation: nodePulse 2s ease infinite;' : ''} ${status === 'pending' ? 'opacity:0.5;' : ''}">${iconContent}</div>
          <div style="font-size:12px; font-weight:600; color:${status === 'pending' ? 'var(--gray-500)' : 'var(--gray-900)'}; margin-bottom:2px;">${node.label}</div>
          <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">${node.roleLabel || ''}</div>
          <div style="font-size:10px; color:${isDone || isFinal ? '#16a34a' : (isActive ? '#f59e0b' : '#a1a1aa')}; font-family:var(--font-mono); ${isActive ? 'font-weight:600;' : ''}">${timeText}</div>
        </div>
      `;
      // 箭头(最后一个节点除外)
      if (idx < nodes.length - 1) {
        const arrowClass = isDone ? 'approval-arrow-done' : (isActive ? 'approval-arrow-active' : '');
        const arrowColor = isDone ? '#16a34a' : (isActive ? '#f59e0b' : '#d4d4d8');
        html += `<div class="approval-arrow ${arrowClass}" style="flex:1; height:36px; display:flex; align-items:center; justify-content:center; color:${arrowColor}; font-size:16px; letter-spacing:-2px; font-weight:700; min-width:24px; ${isActive ? 'animation: arrowFlow 1.5s ease infinite;' : ''}">━━━</div>`;
      }
    });
    container.innerHTML = html;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  }

  // ============ 操作区渲染 ============
  function renderActionArea(area, template, currentIdx, instanceKey, subjectLabel) {
    if (!window.RBAC) return;
    const user = window.RBAC.getCurrentUser();
    const role = window.RBAC.getCurrentRole();
    const roleId = window.RBAC.getCurrentRoleId();
    const nodes = template.nodes;
    const currentNode = nodes[currentIdx];

    // 流程已完成
    if (currentIdx >= nodes.length - 1) {
      area.style.background = 'linear-gradient(135deg, var(--success-bg) 0%, white 100%)';
      area.style.border = '1px solid var(--success-border)';
      area.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <span style="font-size:24px;">🎉</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--success);">流程已完成 · ${subjectLabel || ''} 已生效</div>
            <div style="font-size:12px; color:var(--gray-700); margin-top:2px;">全部 ${nodes.length - 1} 个审批节点已通过 · 总耗时 ${template.avgDuration}</div>
          </div>
        </div>
        <button class="btn btn-default btn-sm" onclick="window.Workflow.reset('${instanceKey}')">重置流程（演示用）</button>
      `;
      return;
    }

    // 当前用户是不是该审批人
    const canApprove = currentNode.perm && window.RBAC.can(currentNode.perm);
    const isCurrentApprover = canApprove && (roleId === currentNode.role || roleId === 'admin');

    if (isCurrentApprover) {
      // 当前用户可以审批
      area.style.background = 'linear-gradient(135deg, #fef3c7 0%, white 100%)';
      area.style.border = '1px solid #fcd34d';
      area.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <span style="font-size:24px;">👋</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--warning);">${user.name},现在轮到您${currentNode.label}了</div>
            <div style="font-size:12px; color:var(--gray-700); margin-top:2px;">作为${role.name},您需要确认 ${subjectLabel || '本流程'} 的<strong>${currentNode.label}</strong>。</div>
          </div>
        </div>
        <button class="btn btn-default btn-sm" onclick="window.Workflow.reject('${instanceKey}')" style="color:var(--danger);">退回上一节点</button>
        <button class="btn btn-primary btn-sm" style="background:var(--success); border-color:var(--success);" onclick="window.Workflow.approve('${instanceKey}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align:middle; margin-right:2px;"><polyline points="20 6 9 17 4 12"/></svg>
          通过 (作为 ${role.short})
        </button>
      `;
    } else if (roleId === 'pm' && nodes.some((n, i) => i < currentIdx && n.role === 'pm')) {
      // PM 已批准过(发起人)
      area.style.background = 'linear-gradient(135deg, var(--success-bg) 0%, white 100%)';
      area.style.border = '1px solid var(--success-border)';
      area.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <span style="font-size:24px;">✓</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--success);">您已批准 · 等候后续节点</div>
            <div style="font-size:12px; color:var(--gray-700); margin-top:2px;">当前节点:<strong>${currentNode.label}</strong>(${currentNode.roleLabel})· 请耐心等候。</div>
          </div>
        </div>
        <button class="btn btn-default btn-sm">催办</button>
      `;
    } else if (roleId === 'viewer' || roleId === 'sales' || (currentNode.perm && !window.RBAC.can(currentNode.perm))) {
      // 无权限只读
      area.style.background = 'linear-gradient(135deg, var(--gray-50) 0%, white 100%)';
      area.style.border = '1px solid var(--gray-200)';
      area.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <span style="font-size:24px;">👁</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--gray-700);">您正以${role.name}身份查看（无审批权限）</div>
            <div style="font-size:12px; color:var(--gray-500); margin-top:2px;">该流程当前在<strong>${currentNode.label}</strong>节点。</div>
          </div>
        </div>
      `;
    } else {
      // 其他角色:等候
      area.style.background = 'linear-gradient(135deg, var(--info-bg) 0%, white 100%)';
      area.style.border = '1px solid var(--info-border)';
      area.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <span style="font-size:24px;">⏳</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--info);">等候轮到您的环节</div>
            <div style="font-size:12px; color:var(--gray-700); margin-top:2px;">当前在<strong>${currentNode.label}</strong>(${currentNode.roleLabel})节点处理中。</div>
          </div>
        </div>
      `;
    }
  }

  // ============ 通过/退回操作 ============
  function approve(instanceKey) {
    const state = getInstanceState(instanceKey, 0);
    const tplKey = state.templateKey;
    const template = TEMPLATES[tplKey];
    if (!template) return;
    const user = window.RBAC ? window.RBAC.getCurrentUser() : { name: '系统' };
    const fromNode = template.nodes[state.currentNodeIdx];
    state.history = state.history || [];
    state.history.push({
      nodeIdx: state.currentNodeIdx,
      nodeLabel: fromNode ? fromNode.label : '',
      action: 'approve',
      user: user.name,
      time: Date.now()
    });
    state.currentNodeIdx = Math.min(state.currentNodeIdx + 1, template.nodes.length - 1);
    setInstanceState(instanceKey, state);

    // 通过动画:当前节点绿色闪一下
    renderedFlows.forEach(opts => {
      const container = document.getElementById(opts.containerId);
      if (!container) return;
      const nodeEl = container.querySelector(`[data-node-idx="${state.currentNodeIdx - 1}"]`);
      if (!nodeEl) return;
      const icon = nodeEl.querySelector('.approval-icon');
      if (icon) {
        icon.style.transition = 'all 300ms';
        icon.style.transform = 'scale(1.2)';
        icon.style.boxShadow = '0 0 0 8px rgba(22, 163, 74, 0.3)';
        setTimeout(() => {
          icon.style.transform = '';
          icon.style.boxShadow = '';
        }, 500);
      }
    });

    showToast(`✓ 已通过审批 · 流程推进到下一节点`, 'success');

    // 第 5 项: 发送站内通知通知
    const nextNode = template.nodes[state.currentNodeIdx];
    const isComplete = state.currentNodeIdx >= template.nodes.length - 1;
    if (isComplete) {
      sendWxNotify(`✅ 流程已完成 · ${template.name} 已生效 · 最终批准人:${user.name}`, 'complete');
      // 第 1 项: 流程完成时触发 ERP 同步动画
      setTimeout(() => triggerErpSync(instanceKey, template), 1200);
    } else {
      sendWxNotify(`审批推进 · ${template.name} · 「${fromNode ? fromNode.label : ''}」已通过 · 下一节点「${nextNode ? nextNode.label : ''}」请尽快处理`, 'approve');
    }

    setTimeout(() => rerenderAll(), 800);
  }

  function reject(instanceKey) {
    const state = getInstanceState(instanceKey, 0);
    const tplKey = state.templateKey;
    const template = TEMPLATES[tplKey];
    if (!template) return;
    const user = window.RBAC ? window.RBAC.getCurrentUser() : { name: '系统' };
    const reason = prompt('请输入退回原因（可选）:', '需补充材料 / 不符合规范');
    if (reason === null) return;  // 用户取消

    state.history = state.history || [];
    state.history.push({
      nodeIdx: state.currentNodeIdx,
      action: 'reject',
      user: user.name,
      reason: reason || '未填写原因',
      time: Date.now()
    });
    const fromIdx = state.currentNodeIdx;
    state.currentNodeIdx = Math.max(state.currentNodeIdx - 1, 0);
    setInstanceState(instanceKey, state);

    // 退回动画:当前节点先红色闪烁,再渲染新状态
    renderedFlows.forEach(opts => {
      const container = document.getElementById(opts.containerId);
      if (!container) return;
      const nodeEl = container.querySelector(`[data-node-idx="${fromIdx}"]`);
      if (!nodeEl) return;
      // 添加退回动画 class
      nodeEl.classList.add('approval-rejecting');
      const icon = nodeEl.querySelector('.approval-icon');
      if (icon) {
        icon.style.transition = 'all 400ms';
        icon.style.background = '#dc2626';
        icon.style.boxShadow = '0 0 0 6px rgba(220, 38, 38, 0.25)';
        icon.style.animation = 'rejectShake 0.5s ease 3';
      }
    });

    showToast(`↩ 已退回 · 原因:${reason || '未填写'}`, 'danger');
    sendWxNotify(`审批退回 · ${template.name} · 退回原因:${reason || '未填写'} · 由 ${user.name} 操作`, 'reject');
    setTimeout(() => rerenderAll(), 1600);
  }

  // ============ 第 4 项:渲染审批历史时间轴 ============
  function renderHistory(containerId, instanceKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const state = getInstanceState(instanceKey, 0);
    const tplKey = state.templateKey;
    const template = TEMPLATES[tplKey];
    if (!template) return;

    const history = state.history || [];
    if (history.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--gray-500); font-size: 12px;">
          <div style="font-size: 28px; margin-bottom: 6px;">📋</div>
          流程刚开始,暂无审批历史
        </div>
      `;
      return;
    }

    // 时间格式化
    function fmt(ts) {
      const d = new Date(ts);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${m}-${day} ${h}:${mi}`;
    }
    function relTime(ts) {
      const diff = Date.now() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      return Math.floor(diff / 86400000) + ' 天前';
    }

    let html = '<div style="position: relative;">';
    // 时间轴竖线
    html += '<div style="position: absolute; left: 21px; top: 0; bottom: 0; width: 2px; background: var(--gray-150);"></div>';

    history.slice().reverse().forEach((event, idx) => {
      const isFirst = idx === 0;
      const isApprove = event.action === 'approve';
      const isReject = event.action === 'reject';
      const node = template.nodes[event.nodeIdx];
      const iconColor = isApprove ? '#16a34a' : (isReject ? '#dc2626' : '#71717a');
      const actionLabel = isApprove ? '通过' : (isReject ? '退回' : event.action);
      const nodeLabel = event.nodeLabel || (node ? node.label : '节点');
      html += `
        <div style="display: flex; gap: 14px; padding: 12px 0; position: relative;">
          <div style="position: relative; flex-shrink: 0; z-index: 1;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: white; border: 3px solid ${iconColor}; display: grid; place-items: center; color: ${iconColor}; font-size: 18px; font-weight: 700;">
              ${isApprove ? '✓' : (isReject ? '↩' : '·')}
            </div>
          </div>
          <div style="flex: 1; padding-top: 4px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 600; color: var(--gray-900);">${event.user}</span>
              <span style="font-size: 11px; padding: 1px 7px; border-radius: 8px; background: ${isApprove ? 'var(--success-bg)' : 'var(--danger-bg)'}; color: ${iconColor}; font-weight: 600; border: 1px solid ${isApprove ? 'var(--success-border)' : '#fca5a5'};">${actionLabel}</span>
              <span style="font-size: 12px; color: var(--gray-700);">「${nodeLabel}」</span>
              ${isFirst ? '<span class="diff-tag diff-up" style="font-size:10px;">最新</span>' : ''}
            </div>
            <div style="font-size: 11px; color: var(--gray-500);">
              <span style="font-family: var(--font-mono);">${fmt(event.time)}</span>
              <span style="margin: 0 6px;">·</span>
              ${relTime(event.time)}
            </div>
            ${event.reason ? `<div style="margin-top: 6px; padding: 8px 10px; background: var(--danger-bg); border-left: 3px solid var(--danger); border-radius: 4px; font-size: 12px; color: var(--gray-700);"><strong>退回原因:</strong>${event.reason}</div>` : ''}
          </div>
        </div>
      `;
    });

    // 流程发起记录(始终显示在最底部)
    if (history.length > 0) {
      const firstTime = history[0].time;
      html += `
        <div style="display: flex; gap: 14px; padding: 12px 0; position: relative;">
          <div style="position: relative; flex-shrink: 0; z-index: 1;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: white; border: 3px solid var(--ai); display: grid; place-items: center; color: var(--ai); font-size: 14px;">🚀</div>
          </div>
          <div style="flex: 1; padding-top: 4px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--gray-900); margin-bottom: 2px;">流程发起</div>
            <div style="font-size: 11px; color: var(--gray-500);">${template.name} · 由系统创建</div>
          </div>
        </div>
      `;
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // ============ 第 1 项:流程完成后 ERP 回写同步 ============
  function triggerErpSync(instanceKey, template) {
    // 根据流程模板决定推送到 ERP 的什么模块
    const erpTargets = {
      'ecn-review':      { erp: '金蝶 K/3', module: 'BOM 变更模块', operation: '更新 BOM 主数据 + 触发工单切换', icon: '🔄' },
      'bom-submit':      { erp: '用友 U8',  module: 'BOM 管理',     operation: '新建 BOM 主数据 + 同步物料用量',     icon: '📋' },
      'po-small':        { erp: '金蝶 K/3', module: '采购管理',     operation: '生成采购订单 PO · 自动审核通过',     icon: '💰' },
      'po-medium':       { erp: '金蝶 K/3', module: '采购管理',     operation: '生成采购订单 PO · 经审批 ¥86,400',   icon: '💰' },
      'po-large':        { erp: '金蝶 K/3', module: '采购管理',     operation: '生成采购订单 PO · 经审批 ¥320,000',  icon: '💰' },
      'material-new':    { erp: '用友 U8',  module: '存货档案',     operation: '新增物料档案 + 编码 + 分类',         icon: '📦' },
      'customer-letter': { erp: '微软 Outlook + CRM', module: '客户文档', operation: '归档告知函 + 发送邮件 + CRM 留痕', icon: '📧' },
    };
    const cfg = erpTargets[template.id || ''] || erpTargets[Object.keys(erpTargets).find(k => TEMPLATES[k] === template)];
    if (!cfg) return;

    // 创建 ERP 同步浮窗（屏幕中央）
    const overlay = document.createElement('div');
    overlay.id = 'erp-sync-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.4); backdrop-filter:blur(4px); z-index:10002; display:grid; place-items:center; opacity:0; transition:opacity 280ms;';
    overlay.innerHTML = `
      <div style="width:520px; background:white; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,0.25); overflow:hidden; transform:translateY(20px) scale(0.96); transition:all 320ms cubic-bezier(0.16, 1, 0.3, 1);" id="erp-sync-panel">
        <div style="padding:18px 22px; background:linear-gradient(135deg, #00890b 0%, #006e09 100%); color:white;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.3); border-radius:10px; display:grid; place-items:center; font-size:18px;">${cfg.icon}</div>
            <div>
              <div style="font-size:14px; font-weight:700;">流程已生效 · 正在回写 ERP</div>
              <div style="font-size:11px; color:rgba(255,255,255,0.8); margin-top:2px;">${template.name} · 数据自动同步</div>
            </div>
          </div>
        </div>
        <div style="padding:22px;">
          <!-- ERP 系统信息 -->
          <div style="display:flex; align-items:center; gap:14px; padding:14px 16px; background:var(--gray-50); border-radius:10px; margin-bottom:16px;">
            <div style="width:52px; height:52px; background:#fee2e2; border-radius:10px; display:grid; place-items:center; color:#dc2626; font-weight:800; font-size:11px; text-align:center; line-height:1.2;">${cfg.erp.split(' ')[0]}</div>
            <div style="flex:1;">
              <div style="font-size:13px; font-weight:700; color:var(--gray-900);">${cfg.erp}</div>
              <div style="font-size:11px; color:var(--gray-500); margin-top:2px;">目标模块:${cfg.module}</div>
              <div style="font-size:11px; color:var(--gray-700); margin-top:2px;">${cfg.operation}</div>
            </div>
            <div id="erp-status" style="font-size:11px; padding:4px 10px; background:#fef3c7; color:#f59e0b; border:1px solid #fcd34d; border-radius:10px; font-weight:600;">同步中...</div>
          </div>

          <!-- 进度步骤 -->
          <div id="erp-steps">
            <div class="erp-step" data-i="0" style="display:flex; align-items:center; gap:10px; padding:8px 0; font-size:12px;">
              <span class="erp-step-icon" style="width:20px; height:20px; border-radius:50%; border:2px solid var(--gray-200); display:grid; place-items:center; flex-shrink:0;"></span>
              <span style="color:var(--gray-700);">检查 ERP 连接状态</span>
            </div>
            <div class="erp-step" data-i="1" style="display:flex; align-items:center; gap:10px; padding:8px 0; font-size:12px;">
              <span class="erp-step-icon" style="width:20px; height:20px; border-radius:50%; border:2px solid var(--gray-200); display:grid; place-items:center; flex-shrink:0;"></span>
              <span style="color:var(--gray-700);">数据格式转换（ezPLM → ERP Schema）</span>
            </div>
            <div class="erp-step" data-i="2" style="display:flex; align-items:center; gap:10px; padding:8px 0; font-size:12px;">
              <span class="erp-step-icon" style="width:20px; height:20px; border-radius:50%; border:2px solid var(--gray-200); display:grid; place-items:center; flex-shrink:0;"></span>
              <span style="color:var(--gray-700);">调用 ${cfg.erp} API · ${cfg.module}</span>
            </div>
            <div class="erp-step" data-i="3" style="display:flex; align-items:center; gap:10px; padding:8px 0; font-size:12px;">
              <span class="erp-step-icon" style="width:20px; height:20px; border-radius:50%; border:2px solid var(--gray-200); display:grid; place-items:center; flex-shrink:0;"></span>
              <span style="color:var(--gray-700);">写入成功 · 接收 ERP 返回单号</span>
            </div>
            <div class="erp-step" data-i="4" style="display:flex; align-items:center; gap:10px; padding:8px 0; font-size:12px;">
              <span class="erp-step-icon" style="width:20px; height:20px; border-radius:50%; border:2px solid var(--gray-200); display:grid; place-items:center; flex-shrink:0;"></span>
              <span style="color:var(--gray-700);">回写 ezPLM:更新流程实例状态</span>
            </div>
          </div>

          <!-- 完成区（隐藏）-->
          <div id="erp-success" style="display:none; margin-top:16px; padding:14px 16px; background:linear-gradient(135deg, var(--success-bg) 0%, white 100%); border:1px solid var(--success-border); border-radius:10px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
              <span style="width:24px; height:24px; background:var(--success); color:white; border-radius:50%; display:grid; place-items:center; font-size:13px;">✓</span>
              <span style="font-size:13px; font-weight:700; color:var(--success);">同步成功</span>
            </div>
            <div style="font-size:12px; color:var(--gray-700); line-height:1.6;">
              ERP 单号:<span class="cell-mono" style="color:var(--gray-900); font-weight:600;" id="erp-ref-no">—</span><br>
              耗时:<span class="cell-mono" id="erp-cost">—</span><br>
              负责人 ${cfg.erp} 后台已自动审核 · 无需人工干预
            </div>
          </div>
        </div>

        <div style="padding:14px 22px; border-top:1px solid var(--gray-150); background:var(--gray-50); display:flex; justify-content:flex-end; gap:8px;">
          <button id="erp-close-btn" disabled style="padding:6px 14px; background:var(--gray-200); color:var(--gray-500); border:0; border-radius:6px; font-size:12px; font-weight:600; cursor:not-allowed;">同步完成后关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      const panel = document.getElementById('erp-sync-panel');
      if (panel) { panel.style.transform = 'translateY(0) scale(1)'; }
    });

    // 模拟分步推进
    const steps = overlay.querySelectorAll('.erp-step');
    let stepIdx = 0;
    const startTime = Date.now();

    function advanceStep() {
      if (stepIdx >= steps.length) {
        // 完成
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const refNo = generateErpRefNo(template);
        const refEl = document.getElementById('erp-ref-no');
        const costEl = document.getElementById('erp-cost');
        const statusEl = document.getElementById('erp-status');
        const successEl = document.getElementById('erp-success');
        const closeBtn = document.getElementById('erp-close-btn');
        if (refEl) refEl.textContent = refNo;
        if (costEl) costEl.textContent = elapsed + ' 秒';
        if (statusEl) {
          statusEl.textContent = '✓ 已完成';
          statusEl.style.background = 'var(--success-bg)';
          statusEl.style.color = 'var(--success)';
          statusEl.style.borderColor = 'var(--success-border)';
        }
        if (successEl) successEl.style.display = 'block';
        if (closeBtn) {
          closeBtn.disabled = false;
          closeBtn.textContent = '关闭';
          closeBtn.style.background = 'var(--brand)';
          closeBtn.style.color = 'white';
          closeBtn.style.cursor = 'pointer';
          closeBtn.onclick = closeErpSyncOverlay;
        }
        sendWxNotify(`ERP 同步成功 · ${cfg.erp} ${cfg.module} · 单号:${refNo} · 耗时 ${elapsed}s`, 'complete');
        return;
      }
      const step = steps[stepIdx];
      const icon = step.querySelector('.erp-step-icon');
      if (icon) {
        icon.style.background = 'var(--success)';
        icon.style.borderColor = 'var(--success)';
        icon.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>';
      }
      step.style.color = 'var(--gray-900)';
      stepIdx++;
      setTimeout(advanceStep, 400 + Math.random() * 400);
    }

    setTimeout(advanceStep, 400);
  }

  function closeErpSyncOverlay() {
    const o = document.getElementById('erp-sync-overlay');
    if (!o) return;
    o.style.opacity = '0';
    setTimeout(() => o.remove(), 280);
  }

  function generateErpRefNo(template) {
    const prefix = {
      'ecn-review': 'ECN',
      'bom-submit': 'BOM',
      'po-small': 'PO', 'po-medium': 'PO', 'po-large': 'PO',
      'material-new': 'MAT',
      'customer-letter': 'LTR',
    };
    const tplId = Object.keys(TEMPLATES).find(k => TEMPLATES[k] === template);
    const p = prefix[tplId] || 'REF';
    const num = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `K3-${p}-${date}-${num}`;
  }

  // ============ 第 5 项:站内通知通知模拟 ============
  function sendWxNotify(message, type) {
    type = type || 'info';
    const colors = {
      approve:  '#07C160',
      reject:   '#dc2626',
      complete: '#7B61FF',
      info:     '#3b82f6',
    };
    // 创建站内消息样式 Toast(右侧滑入,有站内消息 logo)
    const wxToast = document.createElement('div');
    wxToast.style.cssText = `
      position: fixed;
      top: 80px;
      right: 24px;
      width: 340px;
      padding: 14px 16px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.18);
      z-index: 10001;
      opacity: 0;
      transform: translateX(20px);
      transition: all 320ms cubic-bezier(0.16, 1, 0.3, 1);
      display: flex; gap: 10px; align-items: flex-start;
      border-left: 4px solid ${colors[type] || colors.info};
    `;
    wxToast.innerHTML = `
      <div style="width: 36px; height: 36px; background: #07C160; border-radius: 50%; display: grid; place-items: center; color: white; flex-shrink: 0; font-weight: 800; font-size: 18px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 11.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm7 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM12 2C6.5 2 2 5.6 2 10c0 2.5 1.5 4.7 3.7 6.1L5 19l3.4-1.5c1.1.3 2.3.5 3.6.5 5.5 0 10-3.6 10-8S17.5 2 12 2z"/></svg>
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span style="font-size: 12px; font-weight: 700; color: var(--gray-900);">站内通知 · ezPLM 助手</span>
          <span style="font-size: 10px; color: var(--gray-400); font-family: var(--font-mono);">现在</span>
        </div>
        <div style="font-size: 12px; color: var(--gray-700); line-height: 1.5;">${message}</div>
        <div style="margin-top: 6px; font-size: 10px; color: var(--gray-400);">通过 Webhook 推送到「ezPLM 审批」站内通知群</div>
      </div>
      <button onclick="this.parentElement.remove()" style="background:transparent; border:0; cursor:pointer; color:var(--gray-400); padding:0; align-self:flex-start;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    document.body.appendChild(wxToast);
    requestAnimationFrame(() => {
      wxToast.style.opacity = '1';
      wxToast.style.transform = 'translateX(0)';
    });
    setTimeout(() => {
      wxToast.style.opacity = '0';
      wxToast.style.transform = 'translateX(20px)';
      setTimeout(() => wxToast.remove(), 320);
    }, 4500);
  }

  function reset(instanceKey) {
    resetInstance(instanceKey);
    showToast(`🔄 流程已重置到初始状态`, 'info');
    setTimeout(() => rerenderAll(), 400);
  }

  // ============ 渲染入口 ============
  // 存所有已渲染的流程,reload 时全部重新渲染
  const renderedFlows = [];

  function render(opts) {
    const container = document.getElementById(opts.containerId);
    const area = document.getElementById(opts.actionAreaId);
    if (!container) return;

    const template = TEMPLATES[opts.templateKey];
    if (!template) {
      console.warn('未知流程模板:', opts.templateKey);
      return;
    }

    // 读取实例状态（含模板 key)
    let state = getInstanceState(opts.instanceKey, opts.defaultNodeIdx || 0);
    if (!state.templateKey) {
      state.templateKey = opts.templateKey;
      setInstanceState(opts.instanceKey, state);
    }

    renderNodes(container, template, state.currentNodeIdx, state.history || []);
    if (area) renderActionArea(area, template, state.currentNodeIdx, opts.instanceKey, opts.subjectLabel);

    // 保存配置以便后续重新渲染
    if (!renderedFlows.find(f => f.instanceKey === opts.instanceKey)) {
      renderedFlows.push(opts);
    }
  }

  function rerenderAll() {
    renderedFlows.forEach(opts => render(opts));
  }

  // ============ Toast 通知 ============
  function showToast(msg, type) {
    type = type || 'info';
    const colors = {
      success: '#16a34a',
      warning: '#f59e0b',
      info: '#3b82f6',
      danger: '#dc2626',
    };
    let toast = document.getElementById('wf-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'wf-toast';
      toast.style.cssText = 'position:fixed; top:80px; right:24px; padding:12px 18px; color:white; border-radius:8px; font-size:13px; font-weight:600; box-shadow:0 8px 24px rgba(0,0,0,0.18); z-index:10000; opacity:0; transform:translateY(-10px); transition:all 250ms;';
      document.body.appendChild(toast);
    }
    toast.style.background = colors[type];
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
    }, 2800);
  }

  // ============ 第 1 项（V5）:流程模拟器 Time Travel ============
  function openTimeTravel(instanceKey) {
    const state = getInstanceState(instanceKey, 0);
    const tplKey = state.templateKey;
    const template = TEMPLATES[tplKey];
    if (!template) {
      showToast('未找到流程模板,无法启动模拟器', 'danger');
      return;
    }
    // 关闭已有的
    closeTimeTravel();

    const overlay = document.createElement('div');
    overlay.id = 'time-travel-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.55); backdrop-filter:blur(6px); z-index:10003; display:flex; align-items:center; justify-content:center; padding:24px; opacity:0; transition:opacity 280ms;';
    overlay.innerHTML = `
      <div id="tt-panel" style="width:1080px; max-width:calc(100vw - 48px); max-height:calc(100vh - 48px); background:white; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,0.25); display:flex; flex-direction:column; transform:translateY(20px) scale(0.96); transition:all 320ms cubic-bezier(0.16, 1, 0.3, 1);">
        <div style="padding:18px 22px; background:linear-gradient(135deg, #18181b 0%, #3f3f46 100%); color:white; border-radius:14px 14px 0 0; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; background:rgba(255,255,255,0.15); border-radius:10px; display:grid; place-items:center; font-size:18px;">🎬</div>
            <div>
              <div style="font-size:16px; font-weight:600;">流程模拟器 · Time Travel</div>
              <div style="font-size:11px; opacity:0.7; margin-top:2px;">回放/快进流程历史 · 调试和审计 · ${template.name}</div>
            </div>
          </div>
          <button onclick="window.Workflow.closeTimeTravel()" style="background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.18); border-radius:8px; width:32px; height:32px; color:white; cursor:pointer; display:grid; place-items:center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="flex:1; overflow-y:auto; padding:24px;">

          <!-- 流程预览 -->
          <div style="margin-bottom:24px;">
            <div style="font-size:11px; color:var(--gray-500); text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:10px;">流程状态预览</div>
            <div id="tt-flow-preview" style="display:flex; align-items:stretch; gap:0; overflow-x:auto; padding:14px; background:var(--gray-50); border-radius:10px;"></div>
          </div>

          <!-- 时间轴 -->
          <div style="margin-bottom:18px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
              <div style="font-size:11px; color:var(--gray-500); text-transform:uppercase; letter-spacing:0.6px; font-weight:600;">时间轴</div>
              <div style="display:flex; gap:6px; align-items:center;">
                <button onclick="window.Workflow.ttStepBack()" style="padding:6px 12px; background:white; border:1px solid var(--gray-200); border-radius:6px; font-size:12px; cursor:pointer; font-weight:600;">⏮ 上一步</button>
                <button id="tt-play-btn" onclick="window.Workflow.ttPlay()" style="padding:6px 16px; background:var(--ai); color:white; border:0; border-radius:6px; font-size:12px; cursor:pointer; font-weight:600;">▶ 自动播放</button>
                <button onclick="window.Workflow.ttStepForward()" style="padding:6px 12px; background:white; border:1px solid var(--gray-200); border-radius:6px; font-size:12px; cursor:pointer; font-weight:600;">下一步 ⏭</button>
                <div style="height:16px; width:1px; background:var(--gray-300); margin:0 4px;"></div>
                <select id="tt-speed" style="padding:6px 8px; background:white; border:1px solid var(--gray-200); border-radius:6px; font-size:11px;">
                  <option value="1500">慢速 (1.5s)</option>
                  <option value="800" selected>正常 (0.8s)</option>
                  <option value="400">快速 (0.4s)</option>
                </select>
              </div>
            </div>

            <!-- 进度条 -->
            <div style="position:relative; padding:14px 0;">
              <div id="tt-progress-line" style="height:4px; background:var(--gray-100); border-radius:2px; position:relative;">
                <div id="tt-progress-fill" style="position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg, var(--ai) 0%, var(--ai-400) 100%); border-radius:2px; transition:width 320ms;"></div>
              </div>
              <div id="tt-progress-markers" style="position:absolute; left:0; right:0; top:8px; display:flex; justify-content:space-between;"></div>
            </div>

            <!-- 时间轴步骤列表 -->
            <div id="tt-step-list" style="margin-top:18px; max-height:280px; overflow-y:auto;"></div>
          </div>

          <!-- 当前状态详情 -->
          <div id="tt-current-info" style="padding:12px 14px; background:linear-gradient(135deg, var(--ai-50) 0%, white 100%); border:1px solid var(--ai-100); border-radius:10px; font-size:12px; color:var(--gray-700);"></div>

        </div>
        <div style="padding:14px 22px; border-top:1px solid var(--gray-150); background:var(--gray-50); display:flex; align-items:center; justify-content:space-between; border-radius:0 0 14px 14px;">
          <div style="font-size:11px; color:var(--gray-500);">模拟器是只读演示 · 不会修改真实流程数据 · 关闭后恢复原状态</div>
          <button onclick="window.Workflow.closeTimeTravel()" style="padding:7px 14px; background:var(--gray-900); color:white; border:0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">关闭模拟器</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      const panel = document.getElementById('tt-panel');
      if (panel) panel.style.transform = 'translateY(0) scale(1)';
    });

    // 构建虚拟时间轴
    const events = [];
    events.push({
      type: 'create',
      label: '流程发起',
      desc: `${template.name} · 由系统创建`,
      user: '系统',
      time: state.history && state.history[0] ? state.history[0].time - 600000 : Date.now() - 3600000,
      nodeIdx: 0,
    });
    (state.history || []).forEach(h => {
      events.push({
        type: h.action,
        label: h.action === 'approve' ? `通过「${h.nodeLabel || ''}」` : `退回「${h.nodeLabel || ''}」`,
        desc: h.reason ? `退回原因:${h.reason}` : `审批通过 · ${h.user} 操作`,
        user: h.user,
        time: h.time,
        nodeIdx: h.nodeIdx,
        reason: h.reason,
      });
    });
    // 当前状态作为最后一帧
    events.push({
      type: 'now',
      label: '当前状态',
      desc: state.currentNodeIdx >= template.nodes.length - 1 ? '流程已完成 · 已生效' : `等候 ${template.nodes[state.currentNodeIdx].label} 处理`,
      user: '现在',
      time: Date.now(),
      nodeIdx: state.currentNodeIdx,
    });

    // 暴露给后续操作
    window.__ttState = {
      template,
      events,
      currentFrame: events.length - 1,  // 默认显示最新
      playing: false,
      playTimer: null,
    };

    renderTimeTravelFrame();
  }

  function renderTimeTravelFrame() {
    const tt = window.__ttState;
    if (!tt) return;
    const { template, events, currentFrame } = tt;
    const event = events[currentFrame];
    if (!event) return;

    // 1. 流程预览（当前帧对应的节点状态）
    const flowContainer = document.getElementById('tt-flow-preview');
    if (flowContainer) {
      let html = '';
      template.nodes.forEach((node, idx) => {
        const isDone = idx < event.nodeIdx;
        const isActive = idx === event.nodeIdx && event.type !== 'now';
        const isFinal = idx === template.nodes.length - 1 && event.nodeIdx >= idx;
        const status = isDone || isFinal ? 'done' : (isActive || (event.type === 'now' && idx === event.nodeIdx && idx < template.nodes.length - 1) ? 'active' : 'pending');
        const iconBg = status === 'done' ? '#16a34a' : (status === 'active' ? '#f59e0b' : '#d4d4d8');
        const iconContent = status === 'done' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : (node.icon || String(idx + 1));
        const isFocused = event.type !== 'create' && event.type !== 'now' && idx === event.nodeIdx;
        html += `
          <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0; min-width:84px; ${isFocused ? 'transform:scale(1.08);' : ''} transition:transform 250ms;">
            <div style="width:30px; height:30px; border-radius:50%; background:${iconBg}; color:white; display:grid; place-items:center; font-size:11px; font-weight:700; margin-bottom:4px; ${isFocused ? 'box-shadow: 0 0 0 4px ' + (event.type === 'approve' ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)') + ';' : ''} ${status === 'pending' ? 'opacity:0.45;' : ''}">${iconContent}</div>
            <div style="font-size:10px; color:${status === 'pending' ? 'var(--gray-400)' : 'var(--gray-900)'}; text-align:center; font-weight:${isFocused ? '700' : '500'};">${node.label}</div>
          </div>
          ${idx < template.nodes.length - 1 ? `<div style="flex-shrink:0; align-self:center; color:${status === 'done' ? '#16a34a' : '#d4d4d8'}; padding:0 4px;">━</div>` : ''}
        `;
      });
      flowContainer.innerHTML = html;
    }

    // 2. 进度条
    const fillEl = document.getElementById('tt-progress-fill');
    if (fillEl) {
      const pct = events.length > 1 ? (currentFrame / (events.length - 1)) * 100 : 0;
      fillEl.style.width = pct + '%';
    }
    const markersEl = document.getElementById('tt-progress-markers');
    if (markersEl) {
      markersEl.innerHTML = events.map((e, i) => {
        const color = i === currentFrame ? 'var(--ai)' : (i < currentFrame ? '#16a34a' : 'var(--gray-300)');
        return `<div onclick="window.Workflow.ttJump(${i})" title="${e.label}" style="width:14px; height:14px; border-radius:50%; background:${color}; border:3px solid white; cursor:pointer; box-shadow:0 0 0 1px ${color}; ${i === currentFrame ? 'transform:scale(1.2);' : ''} transition:all 200ms;"></div>`;
      }).join('');
    }

    // 3. 步骤列表
    const listEl = document.getElementById('tt-step-list');
    if (listEl) {
      listEl.innerHTML = events.map((e, i) => {
        const isFocused = i === currentFrame;
        const iconBg = e.type === 'approve' ? '#16a34a' : (e.type === 'reject' ? '#dc2626' : (e.type === 'now' ? 'var(--ai)' : '#71717a'));
        const iconText = e.type === 'approve' ? '✓' : (e.type === 'reject' ? '↩' : (e.type === 'now' ? '●' : '○'));
        const timeStr = formatTime(e.time);
        return `
          <div onclick="window.Workflow.ttJump(${i})" style="display:flex; gap:12px; padding:10px 12px; border-radius:8px; cursor:pointer; ${isFocused ? 'background:var(--ai-50); border:1px solid var(--ai-100);' : 'border:1px solid transparent;'} margin-bottom:4px; transition:all 150ms;">
            <div style="flex-shrink:0; width:32px; height:32px; border-radius:50%; background:white; border:2px solid ${iconBg}; color:${iconBg}; display:grid; place-items:center; font-size:13px; font-weight:700;">${iconText}</div>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
                <span style="font-size:13px; font-weight:${isFocused ? '700' : '600'}; color:var(--gray-900);">${e.label}</span>
                ${isFocused ? '<span style="font-size:10px; padding:1px 6px; background:var(--ai); color:white; border-radius:8px; font-weight:600;">当前帧</span>' : ''}
              </div>
              <div style="font-size:11px; color:var(--gray-500);">
                <span style="font-family:var(--font-mono);">${timeStr}</span>
                <span style="margin:0 6px;">·</span>
                ${e.user}
                ${e.desc ? ' · ' + e.desc : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // 4. 当前状态详情
    const infoEl = document.getElementById('tt-current-info');
    if (infoEl) {
      infoEl.innerHTML = `
        <strong style="color:var(--ai-700);">当前查看:</strong>第 ${currentFrame + 1}/${events.length} 帧 · ${event.label} · ${formatTime(event.time)}
        <br>
        <span style="color:var(--gray-500); font-size:11px;">${event.desc}</span>
      `;
    }
  }

  function ttJump(frameIdx) {
    const tt = window.__ttState;
    if (!tt) return;
    tt.currentFrame = Math.max(0, Math.min(frameIdx, tt.events.length - 1));
    renderTimeTravelFrame();
  }

  function ttStepBack() {
    const tt = window.__ttState;
    if (!tt) return;
    ttJump(tt.currentFrame - 1);
  }

  function ttStepForward() {
    const tt = window.__ttState;
    if (!tt) return;
    ttJump(tt.currentFrame + 1);
  }

  function ttPlay() {
    const tt = window.__ttState;
    if (!tt) return;
    const btn = document.getElementById('tt-play-btn');
    if (tt.playing) {
      // 暂停
      tt.playing = false;
      if (tt.playTimer) clearTimeout(tt.playTimer);
      if (btn) btn.innerHTML = '▶ 自动播放';
      return;
    }
    tt.playing = true;
    if (btn) btn.innerHTML = '⏸ 暂停';
    // 从第 0 帧开始
    tt.currentFrame = 0;
    renderTimeTravelFrame();
    const speedEl = document.getElementById('tt-speed');
    const interval = speedEl ? parseInt(speedEl.value) : 800;

    function tick() {
      if (!tt.playing) return;
      if (tt.currentFrame >= tt.events.length - 1) {
        tt.playing = false;
        if (btn) btn.innerHTML = '▶ 重新播放';
        return;
      }
      tt.currentFrame++;
      renderTimeTravelFrame();
      tt.playTimer = setTimeout(tick, interval);
    }
    tt.playTimer = setTimeout(tick, interval);
  }

  function closeTimeTravel() {
    const tt = window.__ttState;
    if (tt && tt.playTimer) clearTimeout(tt.playTimer);
    window.__ttState = null;
    const o = document.getElementById('time-travel-overlay');
    if (!o) return;
    o.style.opacity = '0';
    setTimeout(() => o.remove(), 280);
  }

  // ============ 公开 API ============
  window.Workflow = {
    TEMPLATES,
    render,
    rerenderAll,
    renderHistory,
    sendWxNotify,
    triggerErpSync,
    openTimeTravel,
    closeTimeTravel,
    ttJump,
    ttStepBack,
    ttStepForward,
    ttPlay,
    approve,
    reject,
    reset,
    showToast,
    getInstanceState,
    setInstanceState,
  };
})();
