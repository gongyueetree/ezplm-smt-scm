/* ============================================================
 * ezPLM 合同范围版共享脚本 (contract.js)
 * Toast / Modal / Tabs / Stepper / CSV 导入导出（真实可用）
 * ============================================================ */
(function () {
  'use strict';

  // ---------- Toast ----------
  window.ezToast = function (text, type) {
    let box = document.getElementById('ez-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'ez-toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'ez-toast' + (type ? ' ' + type : '');
    t.textContent = text;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 3200);
  };

  // ---------- Modal ----------
  window.ezModal = function (title, bodyHTML, buttons) {
    const mask = document.createElement('div');
    mask.className = 'ez-modal-mask';
    const btns = (buttons || [{ label: '关闭' }]).map((b, i) =>
      `<button class="btn ${b.cls || ''}" data-mbtn="${i}">${b.label}</button>`).join('');
    mask.innerHTML = `<div class="ez-modal" role="dialog" aria-modal="true">
      <div class="ez-modal-head"><div class="ez-modal-title">${title}</div>
        <button class="ez-modal-x" aria-label="关闭">×</button></div>
      <div class="ez-modal-body">${bodyHTML}</div>
      <div class="ez-modal-foot">${btns}</div></div>`;
    const close = () => mask.remove();
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    mask.querySelector('.ez-modal-x').onclick = close;
    mask.querySelectorAll('[data-mbtn]').forEach(el => {
      el.onclick = () => {
        const b = (buttons || [])[+el.dataset.mbtn] || {};
        if (b.onClick) b.onClick(close); else close();
      };
    });
    document.body.appendChild(mask);
    return { close: close, el: mask };
  };

  // ---------- Tabs ----------
  window.ezTabs = function (rootSel) {
    document.querySelectorAll(rootSel + ' .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const root = tab.closest(rootSel.startsWith('#') ? rootSel : '.tabs').parentElement || document;
        tab.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const paneId = tab.dataset.pane;
        const scope = tab.dataset.scope ? tab.dataset.scope + ' ' : '';
        const panes = document.querySelectorAll(scope + '.tab-pane, ' + scope + '.pane');
        panes.forEach(p => p.classList.toggle('active', (p.id || p.dataset.pane) === paneId));
      });
    });
  };

  // 简易版：自动绑定所有 .tabs（data-pane 指向 pane id）
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tabs').forEach(tabs => {
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const group = tabs.dataset.group;
          const sel = group
            ? `.tab-pane[data-group="${group}"], .pane[data-group="${group}"]`
            : '.tab-pane, .pane';
          document.querySelectorAll(sel).forEach(p => p.classList.toggle('active', (p.id || p.dataset.pane) === tab.dataset.pane));
        });
      });
    });
  });

  // ---------- Stepper ----------
  // ezStepper('#stepper', n) → 标记前 n-1 步 done，第 n 步 current；n 超过步数时全部 done
  window.ezStepper = function (sel, current) {
    const steps = document.querySelectorAll(sel + ' .step');
    const total = steps.length;
    steps.forEach((s, i) => {
      const done = i < current - 1 || current > total;
      const cur = i === current - 1 && current <= total;
      s.classList.toggle('done', done);
      s.classList.toggle('current', cur);
    });
  };

  // ---------- CSV 导出（真实下载）----------
  window.ezExportCSV = function (filename, headers, rows) {
    // 兼容两种调用方式：
    //   3 参：ezExportCSV(name, headers[], rows[][])
    //   2 参：ezExportCSV(name, table[][])  其中 table[0] 为表头、其余为数据行
    if (rows === undefined && Array.isArray(headers) && Array.isArray(headers[0])) {
      rows = headers.slice(1);
      headers = headers[0];
    }
    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      ezToast('导出失败：数据格式不正确', 'warn');
      return;
    }
    if (!/\.csv$/i.test(filename)) { filename += '.csv'; }
    const esc = v => {
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [headers.map(esc).join(',')]
      .concat(rows.map(r => r.map(esc).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ezToast('已导出 ' + filename + '（' + rows.length + ' 行）');
  };

  // ---------- CSV 导入（真实解析，简化版）----------
  window.ezImportCSV = function (onRows, accept) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '.csv,.txt,.xlsx,.xls';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      if (/\.xlsx?$/i.test(f.name)) {
        // 原型环境不内置 xlsx 解析库 → 提示走 CSV 或后端解析
        ezToast('原型环境请使用 CSV；正式版由后端解析 Excel（' + f.name + '）', 'warn');
        onRows(null, f.name);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const rows = text.split(/\r?\n/).filter(l => l.trim()).map(line => {
          const out = []; let cur = '', q = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) {
              if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
              else if (c === '"') q = false;
              else cur += c;
            } else if (c === '"') q = true;
            else if (c === ',') { out.push(cur); cur = ''; }
            else cur += c;
          }
          out.push(cur);
          return out;
        });
        onRows(rows, f.name);
      };
      reader.readAsText(f, 'utf-8');
    };
    input.click();
  };

  // ---------- 金额格式 ----------
  window.ezMoney = n => '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  // ---------- 操作日志（写入 localStorage 仅为原型演示）----------
  window.ezLog = function (action, detail) {
    try {
      const logs = JSON.parse(sessionStorage.getItem('ez-oplog') || '[]');
      logs.unshift({ t: new Date().toLocaleString('zh-CN'), u: '王工 (PM)', action, detail });
      sessionStorage.setItem('ez-oplog', JSON.stringify(logs.slice(0, 50)));
    } catch (e) { /* file:// opaque origin 下 sessionStorage 不可用，忽略 */ }
  };
  // file:// 安全读取操作日志（opaque origin 下 sessionStorage 抛错时返回空数组）
  window.ezReadLog = function () {
    try { return JSON.parse(sessionStorage.getItem('ez-oplog') || '[]'); }
    catch (e) { return []; }
  };
})();
