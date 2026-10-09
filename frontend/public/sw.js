/* Service worker «Цифровой поток» — Web Push + безопасное обновление.
 * HTML-переходы (ярлык на рабочем столе) всегда с сети, без Cache Storage.
 * API/ассеты не перехватываем. URL всегда /sw.js, scope = /.
 * Плейсхолдер версии подменяется при vite build. */
const APP_VERSION = "__ITFLUX_APP_VERSION__";
const SW_VERSION = `itflux-sw-${APP_VERSION}`;

let lastNavDiagAt = 0;

function postSwDiag(type, extra) {
  const payload = { type, t: Date.now(), ...(extra || {}) };
  console.info("[ITFLUX_SW]", type, extra || {});
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => {
      try {
        client.postMessage(payload);
      } catch {
        /* ignore */
      }
    });
  }).catch(() => {});
}

function isLiveLessonUrl(url) {
  try {
    const path = new URL(url).pathname || "";
    return path.includes("/cabinet/meetings/") || path.includes("/lesson/join");
  } catch {
    return false;
  }
}

async function liveLessonIsOpen() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.some((client) => isLiveLessonUrl(client.url));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const live = await liveLessonIsOpen();
    // A waiting worker must not take the open lesson. The browser reloads that page on claim.
    if (!live) self.skipWaiting();
    await postSwDiag("SW_INSTALL", { version: APP_VERSION, liveLesson: live });
  })());
});

async function clearOldCaches() {
  // SW не использует Cache Storage для приложения.
  // Удаляем любые кэши origin (в т.ч. устаревшие leftover), чтобы не отдавать старый JSON/HTML.
  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
}

async function notifyClients() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(
    clients.map((client) =>
      client.postMessage({
        type: "ITFLUX_SW_ACTIVATED",
        version: APP_VERSION,
        swVersion: SW_VERSION,
      }),
    ),
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const live = await liveLessonIsOpen();
    const tasks = [clearOldCaches(), postSwDiag("SW_ACTIVATE", { version: APP_VERSION, liveLesson: live })];
    if (!live) tasks.unshift(self.clients.claim());
    await Promise.all(tasks);
    if (!live) await notifyClients();
  })());
});

// Только переходы по страницам: всегда свежий HTML (ярлык на рабочем столе).
// API, скрипты и картинки не перехватываем — иначе снова закэшируется кабинет.
function isFileDownloadNavigation(url) {
  // iOS не открывает файл, если service worker перехватывает переход
  // (target=_blank / новая вкладка) и сам отвечает на скачивание.
  let path = "";
  try {
    path = decodeURIComponent(new URL(url).pathname || "");
  } catch {
    return false;
  }
  if (path.startsWith("/media/") || path.includes("/media/")) return true;
  if (path.includes("/attached-files/") || /\/attached-file\/?$/.test(path)) return true;
  if (/\/homework\/attachments\/[^/]+\/file\/?$/.test(path)) return true;
  if (/\/files\/(?:shared\/)?[^/]+\/(?:download|preview)\/?$/.test(path)) return true;
  if (/\/materials\/\d+\/(?:file|preview)\/?$/.test(path)) return true;
  if (path.includes("/lesson/attachment/")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate") {
    return;
  }
  if (isFileDownloadNavigation(request.url)) {
    return;
  }
  const now = Date.now();
  if (now - lastNavDiagAt > 5000) {
    lastNavDiagAt = now;
    void postSwDiag("SW_NAVIGATION_FETCH", { path: String(new URL(request.url).pathname || "").slice(0, 80) });
  }
  event.respondWith(
    // Не передавать init: иначе Sec-Fetch-Dest становится empty и API отдает JSON 403
    // вместо HTML/редиректа на предпросмотр после F5 на /api/.../view/.
    fetch(request).catch(() => (
      new Response(
        "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Нет сети</title></head><body style=\"font-family:system-ui,-apple-system,sans-serif;padding:32px 20px;text-align:center;background:#f8fafc;color:#0f172a\"><h1 style=\"font-size:1.2rem\">Нет сети</h1><p>Не удалось загрузить приложение. Проверьте интернет и нажмите «Повторить».</p><button type=\"button\" onclick=\"location.reload()\" style=\"min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#2563eb;color:#fff;font-weight:700\">Повторить</button></body></html>",
        {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      )
    )),
  );
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Цифровой поток",
    body: "Новое уведомление",
    url: "/cabinet",
    tag: "cabinet",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_err) {
    try {
      data.body = event.data ? event.data.text() : data.body;
    } catch (_e) {
      /* ignore */
    }
  }

  const options = {
    body: data.body || "",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: data.tag || "cabinet",
    renotify: Boolean(data.tag),
    data: {
      url: data.url || "/cabinet",
      role: data.role || "",
      event_type: data.event_type || "",
    },
  };

  event.waitUntil(self.registration.showNotification(data.title || "Цифровой поток", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/cabinet";
  let absolute;
  let safePath = "/cabinet";
  try {
    absolute = new URL(raw, self.location.origin);
    // Только same-origin — иначе open redirect через payload push.
    if (absolute.origin !== self.location.origin) {
      absolute = new URL("/cabinet", self.location.origin);
    }
    safePath = `${absolute.pathname}${absolute.search}${absolute.hash}` || "/cabinet";
  } catch {
    absolute = new URL("/cabinet", self.location.origin);
    safePath = "/cabinet";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.postMessage({ type: "ITFLUX_NOTIFICATION_CLICK", url: safePath });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(absolute.href);
      }
      return undefined;
    }),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "ITFLUX_SKIP_WAITING") {
    event.waitUntil((async () => {
      if (await liveLessonIsOpen()) return;
      self.skipWaiting();
    })());
    return;
  }
  if (type === "ITFLUX_GET_VERSION") {
    const port = event.ports && event.ports[0];
    if (port) {
      port.postMessage({ version: APP_VERSION, swVersion: SW_VERSION });
    }
  }
});

self.ITFLUX_APP_VERSION = APP_VERSION;
self.ITFLUX_SW_VERSION = SW_VERSION;
