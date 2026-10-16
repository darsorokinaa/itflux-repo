/** r52: Политика обработки персональных данных (текст — privacyText.js). */
import { Link } from "react-router-dom";
import { PRIVACY_EDITION, PRIVACY_SECTIONS } from "./privacyText";
import "./LegalPages.css";

function PrivacyPage() {
  return (
    <div className="legal-page">
      <h1>Политика обработки персональных данных</h1>
      <p className="legal-edition">Редакция от {PRIVACY_EDITION}</p>
      <nav className="legal-toc" aria-label="Содержание">
        {PRIVACY_SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>{s.h}</a>
        ))}
      </nav>
      {PRIVACY_SECTIONS.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.h}</h2>
          {s.p.map((line) => <p key={line}>{line}</p>)}
        </section>
      ))}
      <p>
        См. также: <Link to="/personal-data-consent">Согласие на обработку персональных данных</Link> ·{" "}
        <Link to="/offer">Публичная оферта</Link> · <Link to="/messages-agreement">Соглашение о сообщениях</Link> ·{" "}
        <Link to="/contacts">Контакты</Link>
      </p>
    </div>
  );
}

export default PrivacyPage;
