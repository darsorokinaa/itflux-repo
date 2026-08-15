/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AnonLimitModal from "./AnonLimitModal";

describe("AnonLimitModal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          registration_promo: {
            active: true,
            message: "Всем зарегистрировавшимся — тариф «Премиум» на 3 месяца.",
          },
        }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the register CTA when the anonymous limit is reached", async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={["/oge/inf"]}>
        <AnonLimitModal open feature="variants" onClose={onClose} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        name: "Нужна регистрация",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Лимит без регистрации исчерпан/)).toBeTruthy();

    const register = screen.getByRole("link", { name: "Зарегистрироваться бесплатно" });
    expect(register.getAttribute("href")).toContain("/cabinet/login");
    expect(register.getAttribute("href")).toContain("mode=register");

    await waitFor(() => {
      expect(
        screen.getByText("Всем зарегистрировавшимся — тариф «Премиум» на 3 месяца."),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalled();
  });
});
