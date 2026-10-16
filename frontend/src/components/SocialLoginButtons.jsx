/** r36: вход через Яндекс ID / VK ID. Кнопки показываются, только если провайдер настроен на сервере. */
import { useEffect, useState } from "react";

export default function SocialLoginButtons({ nextPath = "/cabinet", role = "", consent = null, onConsentMissing = null }) {
  const [providers, setProviders] = useState({ yandex: false, vk: false });
  useEffect(() => {
    let alive = true;
    fetch("/api/cabinet/oauth/providers/", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setProviders({ yandex: !!d.yandex, vk: !!d.vk }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!providers.yandex && !providers.vk) return null;
  const href = (p) => {
    const q = new URLSearchParams({ next: nextPath || "/cabinet" });
    if (role) q.set("role", role);
    // r52: галочки со страницы регистрации (ПД обязательно, реклама — по желанию)
    if (consent?.pd) q.set("pd", "1");
    if (consent?.mkt) q.set("mkt", "1");
    return `/api/cabinet/oauth/${p}/start/?${q.toString()}`;
  };
  const btn = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 44,
    borderRadius: 12, fontWeight: 600, textDecoration: "none", border: "1px solid #d0d5e2", background: "#fff", color: "#111827" };
  const guard = (e) => {
    if (consent && !consent.pd) {
      e.preventDefault();
      if (onConsentMissing) onConsentMissing();
    }
  };
  return (
    <div className="cabinet-auth-social" style={{ display: "grid", gap: 8, margin: "4px 0 14px" }}>
      {providers.yandex ? (
        <a href={href("yandex")} style={btn} rel="nofollow" onClick={guard}>
          <span aria-hidden style={{ background: "#FC3F1D", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>Я</span>
          Войти с Яндекс ID
        </a>
      ) : null}
      {providers.vk ? (
        <a href={href("vk")} style={btn} rel="nofollow" onClick={guard}>
          <span aria-hidden style={{ background: "#0077FF", color: "#fff", borderRadius: 6, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11 }}>VK</span>
          Войти с VK ID
        </a>
      ) : null}
      <div style={{ textAlign: "center", fontSize: 13, color: "#6b7280" }}>или по email и паролю</div>
    </div>
  );
}
