/* Сбрасывает залипший ярлык на рабочем столе (старый HTML/кэш). Без внешних CDN. */
(function () {
  if (window.__ITFLUX_WATCHDOG__) return;
  window.__ITFLUX_WATCHDOG__ = 1;
  window.__ITFLUX_BOOTED = false;
  var params = new URLSearchParams(location.search || "");
  var recovered = params.has("_recover");
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  function appMounted() {
    var root = document.getElementById("root");
    return Boolean(window.__ITFLUX_BOOTED || (root && root.childElementCount > 0));
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
  function showStuck() {
    if (appMounted() || document.getElementById("itflux-boot-recover")) return;
    var box = document.createElement("div");
    box.id = "itflux-boot-recover";
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#f2f4ff;color:#050505;font-family:system-ui,-apple-system,sans-serif;";
    box.innerHTML = recovered
      ? '<div style="max-width:28rem;text-align:center"><p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Страница так и не открылась</p><p style="margin:0 0 16px;line-height:1.5">Если вы заходите с иконки на рабочем столе — удалите её, откройте сайт в Safari или Chrome и добавьте ярлык заново. Звонки на iPhone лучше открывать в браузере, не из иконки.</p><button type="button" id="itflux-boot-reload" style="min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#1550D8;color:#fff;font-weight:700">Обновить ещё раз</button></div>'
      : '<div style="max-width:28rem;text-align:center"><p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Загрузка зависла</p><p style="margin:0 0 16px;line-height:1.5">Так бывает у ярлыка на рабочем столе: телефон держит старую копию сайта. Сбросим кэш и откроем заново.</p><button type="button" id="itflux-boot-reload" style="min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#1550D8;color:#fff;font-weight:700">Обновить приложение</button></div>';
    (document.body || document.documentElement).appendChild(box);
    var reloadBtn = document.getElementById("itflux-boot-reload");
    if (reloadBtn) reloadBtn.onclick = recover;
  }
  setTimeout(showStuck, local ? 25000 : recovered ? 14000 : 9000);
})();
