/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AcademyLandingPage from "./AcademyLandingPage";
import Nav from "../components/Nav";
import { trackGoal } from "../utils/analytics";
import { academyChannels } from "./academyChannels";

vi.mock("../utils/analytics", () => ({ trackGoal: vi.fn() }));
vi.mock("../utils/cabinetAuth", () => ({
  ensureCsrfCookie: vi.fn(async () => {}),
  getCsrfToken: () => "csrf-test",
  fetchCabinetSession: vi.fn(async () => ({ authenticated: false })),
}));
vi.mock("../cabinet/visitContext", () => ({
  readAcquisition: () => ({
    utm_source: "stored",
    utm_medium: "cpc",
    utm_campaign: "",
    utm_content: "",
    referrer: "https://vk.com/itfluxacademy",
  }),
}));
vi.mock("../cabinet/support", () => ({ openSupport: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/academy?utm_source=tg&utm_term=nov"]}>
      <AcademyLandingPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AcademyLandingPage", () => {
  it("shows the approved copy, prices and student channels", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Цифровой поток — онлайн-академия цифровых технологий" })).toBeTruthy();
    expect(screen.getByText(/результаты и разбор домашних работ преподаватель показывает и обсуждает с родителем/)).toBeTruthy();
    expect(screen.getByText("7 900 ₽ в месяц")).toBeTruthy();
    expect(screen.getByText("1 900 ₽ за 60 минут")).toBeTruthy();
    expect(screen.getByText("7 500 ₽ за цикл из 4 занятий по 90 минут")).toBeTruthy();
    expect(screen.getByText("212404973272")).toBeTruthy();
    const telegram = screen.getByRole("link", { name: "t.me/+euR2vXJwj201N2Iy" });
    const vk = screen.getByRole("link", { name: "vk.ru/club243179171" });
    expect(telegram.getAttribute("href")).toBe("https://t.me/+euR2vXJwj201N2Iy");
    expect(vk.getAttribute("href")).toBe("https://vk.ru/club243179171");
    const max = screen.getByRole("link", { name: "max.ru/join/WDCMDl6TEwYOQx6oAYKSB0MotkcpP7fv2uhTBM73OSo" });
    expect(max.getAttribute("href")).toBe("https://max.ru/join/WDCMDl6TEwYOQx6oAYKSB0MotkcpP7fv2uhTBM73OSo");
    expect(screen.queryByRole("link", { name: /itfluxacademy/ })).toBeNull();
    expect(screen.getByText(/Часть домашних заданий проверяется автоматически, остальные проверяет преподаватель/)).toBeTruthy();
    expect(screen.getByText(/После заявки преподаватель выдаёт ученику на платформе набор ключевых заданий в формате экзамена/)).toBeTruthy();
    expect(screen.queryByText(/пробный вариант/)).toBeNull();
    const calls = screen.getAllByRole("link", { name: /Записаться на/ });
    expect(calls).toHaveLength(2);
    for (const link of calls) expect(link.getAttribute("href")).toBe("#academy-form");
    expect(screen.queryByText(/Добавить перед публикацией/)).toBeNull();
    expect(screen.queryByText(/профильной математике/)).toBeNull();
    expect(screen.getByText(/Готовим к ОГЭ и ЕГЭ по информатике\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "согласие на обработку персональных данных" }).getAttribute("href")).toBe("/academy/consent");
    expect(screen.getByRole("link", { name: "Политикой обработки персональных данных" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "Публичная оферта академии" }).getAttribute("href")).toBe("/academy/offer");
    expect(screen.getByRole("link", { name: "Согласие на обработку персональных данных" }).getAttribute("href")).toBe("/academy/consent");
    expect(screen.queryByRole("option", { name: /математика/ })).toBeNull();
  });

  it("shows MAX from the constant and hides it when the constant is empty", () => {
    expect(academyChannels().map((item) => item.id)).toEqual(["telegram", "vk", "max"]);
    expect(academyChannels()[2].href).toBe("https://max.ru/join/WDCMDl6TEwYOQx6oAYKSB0MotkcpP7fv2uhTBM73OSo");
    expect(academyChannels({ max: "" }).map((item) => item.id)).toEqual(["telegram", "vk"]);
  });

  it("shows validation errors and blocks a class/subject mismatch", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Записаться на диагностику" }));
    expect(screen.getByText("Укажите имя ученика.")).toBeTruthy();
    expect(screen.getByText("Выберите класс.")).toBeTruthy();
    expect(screen.getByText("Выберите предмет.")).toBeTruthy();
    expect(screen.getByText("Укажите Telegram @username или телефон.")).toBeTruthy();
    expect(screen.getByText("Нужно согласие на обработку персональных данных.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Предмет"), { target: { value: "ege_inf" } });
    fireEvent.change(screen.getByLabelText("Класс"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Записаться на диагностику" }));
    expect(screen.getByText("Для 9 класса доступен ОГЭ по информатике, для 10–11 классов — ЕГЭ.")).toBeTruthy();
    expect(screen.getByRole("option", { name: "ЕГЭ информатика" }).disabled).toBe(true);
  });

  it("submits a valid request and shows the success text", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: "Заявка принята. Я свяжусь с вами, чтобы выбрать время диагностики и рассказать, как подключиться к платформе." }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    fireEvent.change(screen.getByLabelText("Имя ученика"), { target: { value: "Аня" } });
    fireEvent.change(screen.getByLabelText(/Имя родителя/), { target: { value: "Марина" } });
    fireEvent.change(screen.getByLabelText("Класс"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Предмет"), { target: { value: "ege_inf" } });
    fireEvent.change(screen.getByLabelText(/Контакт/), { target: { value: "@itfluxacademy" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Записаться на диагностику" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Заявка принята. Я свяжусь с вами, чтобы выбрать время диагностики и рассказать, как подключиться к платформе.",
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.utm_source).toBe("tg");
    expect(body.utm_medium).toBe("cpc");
    expect(body.utm_term).toBe("nov");
    expect(body.referrer).toBe("https://vk.com/itfluxacademy");
    expect(body.consent_text_version).toBe("academy_lead_consent_v2");
    expect(body.company_website).toBe("");
    expect(trackGoal).toHaveBeenCalledWith("academy_lead_submit", { subject: "ege_inf", grade: "10" });
  });
});

describe("header link", () => {
  it("shows Онлайн-академия in the site header", async () => {
    render(
      <MemoryRouter initialEntries={["/academy"]}>
        <Nav />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: "Онлайн-академия" });
    expect(link.getAttribute("href")).toBe("/academy");
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});
