/** r50: публичная оферта (текст: offerText.js; копия для юриста — /workspace/offer-draft.docx). */
import { Link } from "react-router-dom";
import { OFFER_EDITION, OFFER_SECTIONS } from "./offerText";
import "./LegalPages.css";

export default function OfferPage() {
  return (
    <div className="legal-page">
      <h1>Публичная оферта на предоставление доступа к онлайн-сервису «Цифровой поток»</h1>
      <p className="legal-edition">Редакция от {OFFER_EDITION}</p>
      {OFFER_SECTIONS.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p.map((line) => <p key={line}>{line}</p>)}
        </section>
      ))}
      <p>
        См. также: <Link to="/privacy">Политика конфиденциальности</Link> · <Link to="/contacts">Контакты</Link> ·{" "}
        <Link to="/pricing">Тарифы</Link>
      </p>
    </div>
  );
}
