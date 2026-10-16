/** r52: ненавязчивый баннер «Подписаться на новости и акции» (MARKETING_PROMPT_V1, double opt-in для e-mail). */
import { useEffect, useState } from "react";
import { r52Get, r52Post } from "./r52api";
import "./r52.css";

export default function MarketingPromptBanner() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(false);
  const [inapp, setInapp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    r52Get("consent/status/").then((d) => { if (alive) setStatus(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (done) {
    return (
      <div className="r52-banner r52-banner--done" role="status">
        <span>{done}</span>
        <button type="button" className="r52-link" onClick={() => setDone("")}>Закрыть</button>
      </div>
    );
  }
  if (!status?.prompt?.show || status?.pd_required) return null;
  const t = status.prompt.texts || {};

  const act = async (body) => {
    setBusy(true); setErr("");
    try {
      const d = await r52Post("marketing/prompt/", body);
      setStatus(d);
      if (body.action === "subscribe") {
        setDone(body.email
          ? "Почти готово: мы отправили письмо на ваш e-mail — подтвердите подписку по ссылке в нём."
          : "Готово: новости и предложения будут приходить в разделе «Сообщения».");
      }
    } catch (ex) { setErr(ex.message || "Не удалось сохранить"); } finally { setBusy(false); }
  };

  return (
    <div className="r52-banner" role="region" aria-label="Подписка на новости">
      {!open ? (
        <>
          <span className="r52-banner__text">Подписаться на новости и акции «Цифрового потока»? Расскажем о новых возможностях и специальных предложениях.</span>
          <span className="r52-banner__actions">
            <button type="button" className="r52-btn r52-btn--sm" onClick={() => setOpen(true)}>Подписаться на новости и акции</button>
            <button type="button" className="r52-link" disabled={busy} onClick={() => act({ action: "dismiss" })}>Не сейчас</button>
          </span>
        </>
      ) : (
        <div className="r52-banner__form">
          <strong>{t.title || "Хотите получать новости и полезные обновления?"}</strong>
          <label className="r52-check">
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
            <span><b>{t.email_label}.</b> {t.email_text}</span>
          </label>
          <label className="r52-check">
            <input type="checkbox" checked={inapp} onChange={(e) => setInapp(e.target.checked)} />
            <span><b>{t.inapp_label}.</b> {t.inapp_text}</span>
          </label>
          <p className="r52-note">{t.note} Для e-mail мы пришлём письмо со ссылкой для подтверждения.</p>
          {err ? <p className="r52-err" role="alert">{err}</p> : null}
          <span className="r52-banner__actions">
            <button type="button" className="r52-btn r52-btn--sm" disabled={busy || (!email && !inapp)} onClick={() => act({ action: "subscribe", email, inapp })}>
              {busy ? "Сохраняем…" : "Подписаться"}
            </button>
            <button type="button" className="r52-link" disabled={busy} onClick={() => act({ action: "dismiss" })}>Не сейчас</button>
          </span>
        </div>
      )}
    </div>
  );
}
