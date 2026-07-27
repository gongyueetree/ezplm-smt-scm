/* ezPLM 审批移动端 PWA Service Worker
 * 提供:推送通知 / 离线缓存
 */
const CACHE_NAME = 'ezplm-approval-v1';
const PRECACHE_URLS = [
  './wx-approval.html',
  './wx-shell.css',
  './rbac.js',
  './workflow.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('SW precache 部分失败:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      );
    })
  );
  self.clients.claim();
});

// 离线优先策略
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => caches.match('./wx-approval.html'));
    })
  );
});

// 推送通知
self.addEventListener('push', event => {
  let data = { title: 'ezPLM 审批', body: '您有新的待审批事项' };
  try { if (event.data) data = event.data.json(); } catch (e) {}

  const options = {
    body: data.body,
    icon: data.icon || './icon-192.png',
    badge: './badge-72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || './wx-approval.html' },
    actions: [
      { action: 'approve', title: '✓ 一键通过' },
      { action: 'view', title: '查看详情' },
    ],
    tag: data.tag || 'ezplm-approval',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;
  const url = event.notification.data.url || './wx-approval.html';
  if (action === 'approve') {
    // 一键通过 - 打开页面并自动操作
    event.waitUntil(clients.openWindow(url + '?action=approve'));
  } else {
    event.waitUntil(clients.openWindow(url));
  }
});
