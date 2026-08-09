/** @vitest-environment jsdom */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SupportContactLink from "../components/SupportContactLink";
import { SUPPORT_OPEN_EVENT } from "../support";

describe("subscription support entry points", () => {
  afterEach(() => {
    cleanup();
  });

  it("subscription page support link opens the shared SupportModal event", () => {
    const spy = vi.fn();
    window.addEventListener(SUPPORT_OPEN_EVENT, spy);
    render(
      <section>
        <h2>Остались вопросы?</h2>
        <SupportContactLink />
      </section>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Связаться с поддержкой" }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(SUPPORT_OPEN_EVENT, spy);
  });

  it("payment error support link opens the same event", () => {
    const spy = vi.fn();
    window.addEventListener(SUPPORT_OPEN_EVENT, spy);
    render(
      <div>
        <p>Не удалось создать платёж. Попробуйте ещё раз.</p>
        <button type="button">Попробовать снова</button>
        <SupportContactLink />
      </div>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Связаться с поддержкой" }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(SUPPORT_OPEN_EVENT, spy);
  });
});
