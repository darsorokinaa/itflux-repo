/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import PricingPage from "./PricingPage";

const preview = {
  valid: true,
  suggested: true,
  code: "potok1110",
  valid_until_label: "30 ноября 2026",
  first_payment_only: true,
  plans: {
    teacher: {
      applies: true,
      promo_applied: true,
      name: "Репетитор",
      base_price: "990.00",
      final_price: "495.00",
      renewal_price: "990.00",
    },
  },
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderPricing(search = "?promo=potok1110") {
  return render(
    <MemoryRouter initialEntries={[`/pricing${search}`]}>
      <PricingPage />
    </MemoryRouter>,
  );
}

describe("PricingPage offer", () => {
  it("shows the server price for Репетитор and keeps the promo field before login", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("promo-preview")) {
        return { ok: true, json: async () => preview };
      }
      if (target.includes("pricing/plans")) {
        return { ok: true, json: async () => ({ plans: [] }) };
      }
      if (target.includes("pricing-me")) {
        return { ok: true, json: async () => ({ authenticated: false }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }));

    renderPricing();

    expect(await screen.findByText(/первый месяц «Репетитор» — 495 ₽/)).toBeTruthy();
    expect(screen.getByText(/далее 990 ₽ в месяц/)).toBeTruthy();
    expect(screen.getByText(/30 ноября 2026/)).toBeTruthy();
    expect(screen.getByLabelText("Промокод")).toBeTruthy();
    expect(screen.getByDisplayValue("potok1110")).toBeTruthy();
    expect(screen.queryByText(/За год/)).toBeNull();
    expect(screen.queryByText(/potok1110y/)).toBeNull();
    const banner = screen.getByText(/первый месяц «Репетитор»/);
    expect(banner.textContent).not.toMatch(/Профи/);
    await waitFor(() => {
      expect(localStorage.getItem("itflux_promo_code")).toBe("potok1110");
    });
  });
});
