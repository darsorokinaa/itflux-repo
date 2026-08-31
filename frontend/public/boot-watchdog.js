/* Автообновление залипшего ярлыка на рабочем столе. Без внешних CDN.
 * Ставится первым в <head>, чтобы таймер запустился даже если CSS/шрифты зависли. */
(function () {
  if (window.__ITFLUX_WATCHDOG__) return;
  window.__ITFLUX_WATCHDOG__ = 1;
  window.__ITFLUX_BOOTED = false;
  var params = new URLSearchParams(location.search || "");
  var recovered = params.has("_recover");
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var meeting = /\/cabinet\/meetings\//.test(location.pathname || "");
  var onCabinetHome = /^\/cabinet\/?$/.test(location.pathname || "");
  // First load of the main bundle on a cold cache often exceeds 8s on desktop too.
  // Auto-recover then fights a still-in-flight load and ends on a blank error screen.
  var timeoutMs = local ? 25000 : recovered ? 22000 : 20000;
  var PAGE_BG = "#f2f4ff";
  var GRID = "linear-gradient(rgba(43,82,245,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(43,82,245,0.04) 1px,transparent 1px)";
  var overlayTimer = 0;

  function appMounted() {
    var root = document.getElementById("root");
    var fatal = document.querySelector("[data-testid='app-error-fallback'], .itflux-fatal-fallback");
    return Boolean((root && root.childElementCount > 0) || fatal);
  }

  function stillLoading() {
    try {
      if (document.readyState !== "complete") return true;
    } catch (err) { /* ignore */ }
    return false;
  }

  function dismissOverlay() {
    var box = document.getElementById("itflux-boot-recover");
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function recover() {
    if (appMounted()) {
      dismissOverlay();
      return;
    }
    var btn = document.getElementById("itflux-boot-reload");
    if (btn) btn.disabled = true;
    var done = function () {
      if (appMounted()) {
        dismissOverlay();
        return;
      }
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

  function bindReload() {
    var reloadBtn = document.getElementById("itflux-boot-reload");
    if (reloadBtn) reloadBtn.onclick = recover;
  }

  function paint(html) {
    if (appMounted()) {
      dismissOverlay();
      return;
    }
    var box = document.getElementById("itflux-boot-recover");
    if (!box) {
      box = document.createElement("div");
      box.id = "itflux-boot-recover";
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background-color:" + PAGE_BG + ";background-image:" + GRID + ";background-size:32px 32px;color:#050505;font-family:system-ui,-apple-system,sans-serif;";
      (document.body || document.documentElement).appendChild(box);
    }
    box.innerHTML = html;
    bindReload();
  }

  function card(inner) {
    return '<div style="width:100%;max-width:28rem;text-align:center;padding:28px 24px;border-radius:20px;background:#fff;border:1px solid #e4e8ff;box-shadow:0 16px 40px rgba(11,47,159,0.12)">' + inner + "</div>";
  }

  function primaryBtn(id, label) {
    return '<button type="button" id="' + id + '" style="min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#1550D8;color:#fff;font-weight:700;cursor:pointer">' + label + "</button>";
  }

  function secondaryLink(href, label) {
    return '<a href="' + href + '" style="min-height:44px;padding:10px 18px;border-radius:12px;background:transparent;border:1.5px solid #1550D8;color:#1550D8;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;box-sizing:border-box">' + label + "</a>";
  }

  function showStuck() {
    if (appMounted()) {
      dismissOverlay();
      return;
    }
    if (navigator.onLine === false) {
      paint(card(
        '<p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Нет сети</p>'
        + '<p style="margin:0 0 16px;line-height:1.5;color:#5a6490">Проверьте Wi-Fi или мобильный интернет и нажмите «Повторить».</p>'
        + primaryBtn("itflux-boot-reload", "Повторить")
      ));
      return;
    }
    if (stillLoading() && !recovered) {
      paint(card(
        '<p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Загружаем кабинет</p>'
        + '<p style="margin:0;line-height:1.5;color:#5a6490">Приложение ещё открывается. Подождите несколько секунд — страница не перезагружается.</p>'
      ));
      if (!overlayTimer) {
        overlayTimer = setTimeout(showStuck, 12000);
        return;
      }
      // Extra wait already used and the shell is still downloading — treat as a stale shortcut.
    }
    if (recovered || meeting) {
      var homeHref = onCabinetHome ? "/" : "/cabinet";
      var homeLabel = onCabinetHome ? "На главную" : "В кабинет";
      paint(card(
        '<p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Не удалось загрузить приложение.</p>'
        + '<p style="margin:0 0 16px;line-height:1.5;color:#5a6490">Попробуйте ещё раз. Если ошибка повторяется — обновите приложение или вернитесь назад.</p>'
        + '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center">'
        + primaryBtn("itflux-boot-reload", "Обновить приложение")
        + secondaryLink(homeHref, homeLabel)
        + "</div>"
      ));
      return;
    }
    paint(card(
      '<p style="font-size:1.15rem;font-weight:700;margin:0 0 10px">Обновляем приложение</p>'
      + '<p style="margin:0;line-height:1.5;color:#5a6490">Ярлык на рабочем столе держал старую копию. Сбрасываем кэш — откроется само.</p>'
    ));
    recover();
  }

  function watchMount() {
    var root = document.getElementById("root");
    if (!root || typeof MutationObserver !== "function") return;
    var obs = new MutationObserver(function () {
      if (!appMounted()) return;
      dismissOverlay();
      obs.disconnect();
    });
    obs.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchMount);
  } else {
    watchMount();
  }

  setTimeout(showStuck, timeoutMs);
  setInterval(function () {
    if (appMounted()) {
      dismissOverlay();
      return;
    }
    if (window.__ITFLUX_BOOTED) showStuck();
  }, 4000);
})();
