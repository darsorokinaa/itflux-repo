/** r52: Политика обработки персональных данных (текст — privacyText.js). */
import { PRIVACY_EDITION, PRIVACY_SECTIONS } from "./privacyText";
import { LegalDraftBanner, LegalFooterLinks, LegalText } from "./legalMarkup";
import "./LegalPages.css";

function PrivacyPage() {
  return (
    <div className="legal-page">
      <LegalDraftBanner>
        В эту редакцию добавлен черновик раздела 12 об онлайн-академии и точечные правки. Не считать опубликованным до проверки юристом и «да» Дарьи. В тексте видны пометки [уточнить] и [юрист].
      </LegalDraftBanner>
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
          {s.p.map((line) => <p key={line}><LegalText text={line} /></p>)}
        </section>
      ))}
      <LegalFooterLinks items={[
        { to: "/personal-data-consent", label: "Согласие на обработку персональных данных" },
        { to: "/academy/consent", label: "Согласие для заявки академии" },
        { to: "/offer", label: "Публичная оферта" },
        { to: "/academy/offer", label: "Оферта академии" },
        { to: "/messages-agreement", label: "Соглашение о сообщениях" },
        { to: "/contacts", label: "Контакты" },
      ]} />
    </div>
  );
}

export default PrivacyPage;
