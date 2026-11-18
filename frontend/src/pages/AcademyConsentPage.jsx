/** Черновик страницы согласия на обработку ПД для заявки академии. Не индексировать до утверждения. */
import {
  ACADEMY_CONSENT_PAGE_EDITION,
  ACADEMY_CONSENT_PAGE_NOTICE,
  ACADEMY_CONSENT_PAGE_PARAS,
  ACADEMY_CONSENT_PAGE_TITLE,
  ACADEMY_CONSENT_VERSION,
} from "./academyConsentText";
import { LegalDraftBanner, LegalFooterLinks, LegalText } from "./legalMarkup";
import "./LegalPages.css";

export default function AcademyConsentPage() {
  return (
    <div className="legal-page">
      <LegalDraftBanner><LegalText text={ACADEMY_CONSENT_PAGE_NOTICE} /></LegalDraftBanner>
      <h1>{ACADEMY_CONSENT_PAGE_TITLE}</h1>
      <p className="legal-edition">{ACADEMY_CONSENT_PAGE_EDITION}</p>
      {ACADEMY_CONSENT_PAGE_PARAS.map((para) => (
        <p key={para.slice(0, 48)}><LegalText text={para} /></p>
      ))}
      <p className="legal-edition">Версия: {ACADEMY_CONSENT_VERSION}</p>
      <LegalFooterLinks items={[
        { to: "/privacy", label: "Политика обработки персональных данных" },
        { to: "/academy/offer", label: "Публичная оферта академии" },
        { to: "/academy", label: "Онлайн-академия" },
        { to: "/contacts", label: "Контакты" },
      ]} />
    </div>
  );
}
