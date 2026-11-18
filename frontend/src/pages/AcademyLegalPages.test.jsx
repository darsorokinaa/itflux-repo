/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AcademyConsentPage from "./AcademyConsentPage";
import AcademyOfferPage from "./AcademyOfferPage";
import AcademyLandingPage from "./AcademyLandingPage";
import { ACADEMY_CONSENT_CHECKBOX_TEXT, ACADEMY_CONSENT_VERSION } from "./academyConsentText";

afterEach(() => cleanup());

describe("academy legal drafts", () => {
  it("shows the offer draft with markers, table and academy footer links", () => {
    render(<MemoryRouter><AcademyOfferPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: /Публичная оферта на оказание услуг по подготовке к ОГЭ и ЕГЭ по информатике/ })).toBeTruthy();
    expect(screen.getByText(/Не публиковать до проверки юристом/)).toBeTruthy();
    expect(screen.getByText(/\[дата публикации\]/)).toBeTruthy();
    expect(document.querySelector(".legal-marker")).toBeTruthy();
    expect(screen.getByText("7 900 ₽ за календарный месяц")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Согласие на обработку персональных данных" }).getAttribute("href")).toBe("/academy/consent");
  });

  it("shows the consent draft with v2 text and lawyer markers", () => {
    render(<MemoryRouter><AcademyConsentPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: /Согласие на обработку персональных данных/ })).toBeTruthy();
    expect(screen.getByText(/Версия: academy_lead_consent_v2/)).toBeTruthy();
    expect(screen.getByText(/нужен ли для Telegram отдельный чекбокс/)).toBeTruthy();
    expect(ACADEMY_CONSENT_VERSION).toBe("academy_lead_consent_v2");
    expect(ACADEMY_CONSENT_CHECKBOX_TEXT).toMatch(/законный представитель/);
  });

  it("keeps landing checkbox wording aligned with the stored v2 text", () => {
    render(
      <MemoryRouter initialEntries={["/academy"]}>
        <AcademyLandingPage />
      </MemoryRouter>,
    );
    const label = screen.getByLabelText(/Я родитель \(законный представитель\) ученика/);
    expect(label).toBeTruthy();
    expect(ACADEMY_CONSENT_CHECKBOX_TEXT).toContain("для связи по заявке и проведения бесплатной диагностики");
  });
});
