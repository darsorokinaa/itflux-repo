/* Service worker «Цифровой поток» — одно PWA для учителя и ученика */
const SW_VERSION = "itflux-pwa-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
  const targetUrl = (event.notification.data && event.notification.data.url) || "/cabinet";
  const absolute = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.postMessage({ type: "ITFLUX_NOTIFICATION_CLICK", url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(absolute);
      }
      return undefined;
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "ITFLUX_SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Keep SW version visible for debugging
self.ITFLUX_SW_VERSION = SW_VERSION;
