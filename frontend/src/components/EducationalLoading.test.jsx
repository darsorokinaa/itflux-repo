/** @vitest-environment jsdom */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EducationalLoading, { LOADING_MESSAGES } from "./EducationalLoading";

const FACT = {
  id: "sample",
  category: "space",
  text: "Свет от Солнца до Земли идёт примерно 8 минут 20 секунд.",
};

describe("EducationalLoading", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the process message and a fact without a fake percent", () => {
    const { container } = render(
      <EducationalLoading message={LOADING_MESSAGES.page} fact={FACT} />,
    );
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Подготавливаем страницу…")).toBeTruthy();
    expect(screen.getByText("Интересный факт")).toBeTruthy();
    expect(screen.getByText(FACT.text)).toBeTruthy();
    expect(container.textContent).not.toMatch(/%/);
    expect(LOADING_MESSAGES.save).toBe("Сохраняем изменения…");
    expect(LOADING_MESSAGES.almost).toBe("Почти готово…");
  });
});
