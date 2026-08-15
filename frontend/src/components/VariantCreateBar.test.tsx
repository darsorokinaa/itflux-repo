/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import VariantCreateBar from "./VariantCreateBar";

const LIMIT_BODY = {
  code: "ANON_VARIANT_LIMIT_REACHED",
  message: "Лимит вариантов без регистрации исчерпан. Зарегистрируйтесь или выберите тариф.",
  feature: "variants",
  upgrade_required: true,
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Forbidden",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("VariantCreateBar anonymous limit", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens the register popup when the anonymous variant limit is reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("pricing/plans") || url.includes("/api/csrf/") || url.includes("/api/cabinet/me/")) {
          return Promise.resolve(jsonResponse({ authenticated: false, registration_promo: { active: false } }));
        }
        return Promise.resolve(jsonResponse(LIMIT_BODY, { ok: false, status: 403 }));
      }),
    );

    render(
      <MemoryRouter>
        <VariantCreateBar
          active
          tasks={[{ id: 1, task_number: 1, text: "Задача" }]}
          level="oge"
          subject="inf"
          subjectName="Информатика"
          onCreated={() => {}}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Создать вариант" }));

    expect(
      await screen.findByRole("heading", {
        name: "Нужна регистрация",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Зарегистрироваться бесплатно" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
