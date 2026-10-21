import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../utils/cabinetAuth", () => ({ ensureCsrfCookie: async () => {}, getCsrfToken: () => "t" }));
import OneShotPopup from "./OneShotPopup";

const popup = { id: 7, title: "Оплата не завершилась", message: "Текст", signature: "Дарья, «Цифровой поток»",
  button_label: "Перейти к тарифам", button_url: "/pricing", close_label: "Закрыть" };

describe("OneShotPopup", () => {
  let calls;
  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push([url, opts?.method || "GET", opts?.body]);
      if (!opts?.method) return { ok: true, json: async () => ({ popup }) };
      return { ok: true, json: async () => ({ ok: true }) };
    });
  });
  afterEach(() => cleanup());

  it("показывает окно, отмечает показ и закрывает", async () => {
    render(<OneShotPopup />);
    expect(await screen.findByText("Оплата не завершилась")).toBeTruthy();
    await waitFor(() => expect(calls.some(([u]) => u.endsWith("/7/seen/"))).toBe(true));
    fireEvent.click(screen.getByText("Закрыть"));
    await waitFor(() => expect(calls.some(([u, , b]) => u.endsWith("/7/close/") && b.includes("close"))).toBe(true));
    expect(screen.queryByText("Оплата не завершилась")).toBeNull();
  });

  it("кнопка ведёт по ссылке в той же вкладке", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
    render(<OneShotPopup />);
    fireEvent.click(await screen.findByText("Перейти к тарифам"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/pricing"));
    expect(calls.some(([u, , b]) => u.endsWith("/7/close/") && b.includes("button"))).toBe(true);
  });

  it("ничего не рисует без окна", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ popup: null }) }));
    const { container } = render(<OneShotPopup />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
