/** Черновик публичной оферты онлайн-академии. Не индексировать до утверждения. */
import {
  ACADEMY_OFFER_EDITION,
  ACADEMY_OFFER_NOTICE,
  ACADEMY_OFFER_SECTIONS,
  ACADEMY_OFFER_SUBTITLE,
  ACADEMY_OFFER_TITLE,
} from "./academyOfferText";
import { LegalBlocks, LegalDraftBanner, LegalFooterLinks, LegalText } from "./legalMarkup";
import "./LegalPages.css";

export default function AcademyOfferPage() {
  return (
    <div className="legal-page">
      <LegalDraftBanner><LegalText text={ACADEMY_OFFER_NOTICE} /></LegalDraftBanner>
      <h1>{ACADEMY_OFFER_TITLE}</h1>
      <p className="legal-subtitle">{ACADEMY_OFFER_SUBTITLE}</p>
      <p className="legal-edition"><LegalText text={ACADEMY_OFFER_EDITION} /></p>
      <nav className="legal-toc" aria-label="Содержание">
        {ACADEMY_OFFER_SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`}>{section.h}</a>
        ))}
      </nav>
      {ACADEMY_OFFER_SECTIONS.map((section) => (
        <section key={section.id} id={section.id}>
          <h2>{section.h}</h2>
          <LegalBlocks blocks={section.blocks} />
        </section>
      ))}
      <LegalFooterLinks items={[
        { to: "/academy/consent", label: "Согласие на обработку персональных данных" },
        { to: "/privacy", label: "Политика обработки персональных данных" },
        { to: "/academy", label: "Онлайн-академия" },
        { to: "/contacts", label: "Контакты" },
      ]} />
    </div>
  );
}
