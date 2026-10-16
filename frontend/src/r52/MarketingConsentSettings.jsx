/** r52: рекламные рассылки в «Настройках уведомлений» — включить (double opt-in) или отозвать согласие. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { r52Get, r52Post } from "./r52api";
import "./r52.css";

export default function MarketingConsentSettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    r52Get("consent/status/").then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  const t = s.prompt?.texts || {};

  const toggle = async (channel, enabled) => {
    setBusy(channel); setMsg("");
    try {
      const d = await r52Post("marketing/settings/", { channel, enabled });
      setS(d);
      if (channel === "email_marketing" && enabled) setMsg("Мы отправили письмо на ваш e-mail — подтвердите подписку по ссылке в нём.");
      else if (!enabled) setMsg("Согласие отозвано. Рекламные сообщения больше не будут приходить.");
      else setMsg("Сохранено.");
    } catch (ex) { setMsg(ex.message || "Не удалось сохранить"); } finally { setBusy(""); }
  };

  const row = (channel, on, label, text, pending) => (
    <div className="r52-set-row">
      <div>
        <p className="r52-set-label">{label}</p>
        <p className="r52-note">{text}</p>
        {pending ? <p className="r52-note"><b>Ожидает подтверждения по ссылке из письма.</b></p> : null}
      </div>
      <button type="button" className={`r52-switch${on ? " is-on" : ""}`} role="switch" aria-checked={on}
        aria-label={label} disabled={busy === channel} onClick={() => toggle(channel, !on)}>
        <span />
      </button>
    </div>
  );

  return (
    <section className="r52-settings" aria-labelledby="r52-set-title">
      <h2 id="r52-set-title">Новости и специальные предложения</h2>
      <p className="r52-note">
        Рекламные рассылки — только с вашего согласия. Служебные уведомления о работе аккаунта и подписке приходят независимо от этих настроек.{" "}
        <Link to="/privacy#rights">Подробнее</Link>
      </p>
      {row("email_marketing", s.marketing?.email, t.email_label || "По электронной почте", t.email_text, s.marketing?.email_pending && !s.marketing?.email)}
      {row("inapp_marketing", s.marketing?.inapp, t.inapp_label || "В сообщениях на платформе", t.inapp_text, false)}
      {msg ? <p className="r52-note" role="status">{msg}</p> : null}
    </section>
  );
}
