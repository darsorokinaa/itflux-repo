/** r52: шаг согласия при первом входе (Яндекс ID / VK ID, если галочки не были показаны до входа). */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MARKETING_EMAIL_TEXT } from "./consentTexts";
import { r52Get, r52Post } from "./r52api";
import "./r52.css";

export default function ConsentStepGate() {
  const location = useLocation();
  const inCabinet = location.pathname.startsWith("/cabinet") && !location.pathname.startsWith("/cabinet/login");
  const [need, setNeed] = useState(false);
  const [pd, setPd] = useState(false);
  const [mkt, setMkt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!inCabinet) return undefined;
    let alive = true;
    r52Get("consent/status/")
      .then((d) => { if (alive) setNeed(Boolean(d?.pd_required)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [inCabinet]);

  if (!inCabinet || !need) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!pd) { setErr("Отметьте согласие на обработку персональных данных — без него платформой пользоваться нельзя."); return; }
    setBusy(true); setErr("");
    try {
      await r52Post("consent/step/", { pd: true, marketing_email: mkt });
      setNeed(false);
    } catch (ex) {
      setErr(ex.message || "Не удалось сохранить");
    } finally { setBusy(false); }
  };

  return (
    <div className="r52-overlay" role="dialog" aria-modal="true" aria-labelledby="r52-step-title">
      <form className="r52-modal" onSubmit={submit}>
        <h2 id="r52-step-title">Добро пожаловать в «Цифровой поток»!</h2>
        <p>Остался один шаг: подтвердите согласие на обработку персональных данных.</p>
        <label className="r52-check">
          <input type="checkbox" checked={pd} onChange={(e) => setPd(e.target.checked)} />
          <span>
            Я даю <Link to="/personal-data-consent" target="_blank">согласие на обработку персональных данных</Link> и
            ознакомлен(а) с <Link to="/privacy" target="_blank">политикой обработки персональных данных</Link>
            <b className="r52-req" aria-label="обязательно">*</b>
          </span>
        </label>
        <label className="r52-check">
          <input type="checkbox" checked={mkt} onChange={(e) => setMkt(e.target.checked)} />
          <span>{MARKETING_EMAIL_TEXT} <em>Необязательно.</em></span>
        </label>
        {err ? <p className="r52-err" role="alert">{err}</p> : null}
        <button type="submit" className="r52-btn" disabled={busy}>{busy ? "Сохраняем…" : "Продолжить"}</button>
      </form>
    </div>
  );
}
