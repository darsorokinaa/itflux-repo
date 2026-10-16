/** r52: Согласие на обработку персональных данных. Текст берётся с сервера (единый источник с журналом согласий). */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./LegalPages.css";

export default function PersonalDataConsentPage() {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/cabinet/r52/consent-text/pd_consent_v1/", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d) => { if (alive) setDoc(d); })
      .catch(() => { if (alive) setError("Не удалось загрузить текст. Обновите страницу."); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="legal-page">
      <h1>{doc?.title || "Согласие на обработку персональных данных"}</h1>
      <p className="legal-edition">{doc?.updated ? `Редакция от ${doc.updated}` : error || "Загрузка…"}</p>
      {(doc?.body || "").split(/\n\n+/).filter(Boolean).map((para) => <p key={para.slice(0, 40)}>{para}</p>)}
      {doc ? <p className="legal-edition">Версия: {doc.version}</p> : null}
      <p>
        См. также: <Link to="/privacy">Политика обработки персональных данных</Link> ·{" "}
        <Link to="/offer">Публичная оферта</Link> · <Link to="/contacts">Контакты</Link>
      </p>
    </div>
  );
}
