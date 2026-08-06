/* Service worker «Цифровой поток» — Web Push + безопасное обновление.
 * Не кэширует HTML/API/материалы (нет fetch handler, нет runtime cache API store).
 * Плейсхолдер версии подменяется при vite build. */
const APP_VERSION = "__ITFLUX_APP_VERSION__";
const SW_VERSION = `itflux-sw-${APP_VERSION}`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
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
  event.waitUntil(
    Promise.all([self.clients.claim(), clearOldCaches()]).then(() => notifyClients()),
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
    self.skipWaiting();
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
