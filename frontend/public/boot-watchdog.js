/* Автообновление залипшего ярлыка на рабочем столе. Без внешних CDN.
 * Ставится первым в <head>, чтобы таймер запустился даже если CSS/шрифты зависли. */
(function () {
  if (window.__ITFLUX_WATCHDOG__) return;
  window.__ITFLUX_WATCHDOG__ = 1;
  window.__ITFLUX_BOOTED = false;
  var params = new URLSearchParams(location.search || "");
  var recovered = params.has("_recover");
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var ua = String(navigator.userAgent || "");
  var mobile = /iPhone|iPad|iPod|Android/i.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // 1MB gzip JS + MathJax on LTE often exceeds 8s. Auto-recover then looks like
  // «страница не открылась» and can fight a still-in-flight first load.
  var timeoutMs = local ? 25000 : recovered ? 18000 : mobile ? 20000 : 8000;

  function appMounted() {
    var root = document.getElementById("root");
    var fatal = document.querySelector("[data-testid='app-error-fallback'], .itflux-fatal-fallback");
    return Boolean((root && root.childElementCount > 0) || fatal);
  }

  function recover() {
    var btn = document.getElementById("itflux-boot-reload");
    if (btn) btn.disabled = true;
    var done = function () {
      var url = new URL(location.href);
      url.searchParams.set("_recover", String(Date.now()));
      location.replace(url.href);
    };
    var pending = [];
    try {
      if ("serviceWorker" in navigator) {
        pending.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (reg) { return reg.unregister(); }));
        }));
      }
      if (window.caches && caches.keys) {
        pending.push(caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (key) { return caches.delete(key); }));
        }));
      }
    } catch (err) { /* ignore */ }
    Promise.all(pending).catch(function () {}).then(done);
  }

  function paint(html) {
    if (document.getElementById("itflux-boot-recover")) return;
    var box = document.createElement("div");
    box.id = "itflux-boot-recover";
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#f2f4ff;color:#050505;font-family:system-ui,-apple-system,sans-serif;";
    box.innerHTML = html;
    (document.body || document.documentElement).appendChild(box);
    var reloadBtn = document.getElementById("itflux-boot-reload");
    if (reloadBtn) reloadBtn.onclick = recover;
  }

  function showStuck() {
    if (appMounted()) return;
    if (navigator.onLine === false) {
      paint(
        '<div style="max-width:28rem;text-align:center"><p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Нет сети</p><p style="margin:0 0 16px;line-height:1.5">Проверьте Wi-Fi или мобильный интернет и нажмите «Повторить».</p><button type="button" id="itflux-boot-reload" style="min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#1550D8;color:#fff;font-weight:700">Повторить</button></div>'
      );
      return;
    }
    var meeting = /\/cabinet\/meetings\//.test(location.pathname || "");
    if (recovered || meeting) {
      paint(
        '<div style="max-width:28rem;text-align:center"><p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Не удалось загрузить приложение.</p><p style="margin:0 0 16px;line-height:1.5">Попробуйте ещё раз. Если ошибка повторяется — обновите приложение или вернитесь в кабинет.</p><div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center"><button type="button" id="itflux-boot-reload" style="min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#1550D8;color:#fff;font-weight:700">Обновить приложение</button><a href="/cabinet" style="min-height:44px;padding:10px 18px;border-radius:12px;background:#fff;color:#1550D8;font-weight:700;text-decoration:none;display:inline-flex;align-items:center">В кабинет</a></div></div>'
      );
      return;
    }
    paint(
      '<div style="max-width:28rem;text-align:center"><p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Обновляем приложение</p><p style="margin:0;line-height:1.5">Ярлык на рабочем столе держал старую копию. Сбрасываем кэш — откроется само.</p></div>'
    );
    recover();
  }

  setTimeout(showStuck, timeoutMs);
  setInterval(function () {
    if (document.getElementById("itflux-boot-recover")) return;
    if (appMounted()) return;
    if (window.__ITFLUX_BOOTED) showStuck();
  }, 4000);
})();
