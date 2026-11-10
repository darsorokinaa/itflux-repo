/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Nav from "../components/Nav";
import HomePiggyBank from "../components/HomePiggyBank";
import { getActiveNavTab, NAV_TABS } from "../config/navTabs";
import ChristmasFundraiserPage from "./ChristmasFundraiserPage";
import { formatRub, snapshotFromPayload } from "./fundraiserAmount";

vi.mock("../utils/cabinetAuth", () => ({
  fetchCabinetSession: () => Promise.resolve({ authenticated: false }),
  getCabinetHomePath: () => "/cabinet/login",
}));

vi.mock("../cabinet/support", () => ({
  openSupport: () => {},
}));

const AMOUNT = { amount_rub: 3715, updated_at: "2026-11-10T15:00:00+03:00" };

function mockFetch(payload: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => payload,
    }),
  );
}

describe("рождественский сбор", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("formats the collected amount and ignores a broken payload", () => {
    expect(formatRub(3715)).toBe("3 715 ₽");
    expect(snapshotFromPayload(AMOUNT)?.amountRub).toBe(3715);
    expect(snapshotFromPayload(AMOUNT)?.goalRub).toBeNull();
    expect(
      snapshotFromPayload({ amount_rub: 100, goal_rub: 1000 })?.goalRub,
    ).toBe(1000);
    expect(snapshotFromPayload(null)).toBeNull();
    expect(snapshotFromPayload({ amount_rub: "3715" })).toBeNull();
    expect(snapshotFromPayload({})).toBeNull();
  });

  it("keeps the fundraiser tab in the header and highlights the route", () => {
    const tab = NAV_TABS.find((item) => item.key === "fundraiser");
    expect(tab?.label).toBe("🎄 Рождественский сбор");
    expect(tab?.to).toBe("/rozhdestvenskiy-sbor");
    expect(getActiveNavTab("/rozhdestvenskiy-sbor")).toBe("fundraiser");
    mockFetch({ authenticated: false });
    render(
      <MemoryRouter initialEntries={["/rozhdestvenskiy-sbor"]}>
        <Nav />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "🎄 Рождественский сбор" });
    expect(link.getAttribute("href")).toBe("/rozhdestvenskiy-sbor");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("renders the page, lazy previews and the full frame in the lightbox", async () => {
    mockFetch(AMOUNT);
    render(
      <MemoryRouter>
        <ChristmasFundraiserPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /Рождественский сбор/ }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Эта большая любовь живёт в моём сердце уже восемь лет/),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "посте о сборе" })).toBeTruthy();
    const longVideo = screen.getAllByRole("link", { name: "посте о сборе" });
    expect(
      longVideo.every(
        (link) =>
          link.getAttribute("href") === "https://t.me/itfluxacademy/615",
      ),
    ).toBe(true);

    const gallery = document.querySelectorAll(".xmas-gallery img");
    expect(gallery).toHaveLength(44);
    expect(gallery[0].getAttribute("src")).toBe(
      "/static-charity/img/xmas_kin_01_sm.jpg",
    );
    expect(gallery[1].getAttribute("src")).toBe(
      "/static-charity/img/xmas_kin_02_sm.jpg",
    );
    expect(gallery[36].getAttribute("src")).toBe(
      "/static-charity/img/xmas_kin_37_sm.jpg",
    );
    expect(gallery[37].getAttribute("src")).toBe(
      "/static-charity/img/photo8_sm.jpg",
    );
    expect(gallery[43].getAttribute("src")).toBe(
      "/static-charity/img/photo4_sm.jpg",
    );
    expect(gallery[43].getAttribute("alt")).toBe("Пакеты с подарками");
    expect(
      document.querySelector(".xmas-gallery figcaption")?.textContent,
    ).toBe("Рождество, Кинешма");
    expect(screen.getByText("Подарки")).toBeTruthy();

    const video = document.querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      "/static-charity/video/IMG_9797.mp4",
    );
    expect(video?.getAttribute("poster")).toBe(
      "/static-charity/video/IMG_9797.jpg",
    );
    expect(document.querySelector(".xmas-fund__qr")?.getAttribute("src")).toBe(
      "/static-charity/img/qr.png",
    );

    await waitFor(() => {
      expect(screen.getAllByText("3 715 ₽").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Уже собрано")).toBeTruthy();

    fireEvent.click(gallery[0]);
    const dialog = screen.getByRole("dialog", { name: "Просмотр фото" });
    const full = dialog.querySelector("img");
    expect(full?.getAttribute("src")).toBe(
      "/static-charity/img/xmas_kin_01.jpg",
    );
    expect(full?.getAttribute("src")).not.toContain("_sm");
    expect(dialog.textContent).toContain("Рождество, Кинешма");
  });

  it("hides the amount when the endpoint fails", async () => {
    mockFetch(null, false);
    render(
      <MemoryRouter>
        <ChristmasFundraiserPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /Рождественский сбор/ }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Уже собрано")).toBeNull();
    });
    expect(screen.queryByText(/0 ₽/)).toBeNull();
    expect(screen.queryByText("3 715 ₽")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Помочь" }).length,
    ).toBeGreaterThan(0);
  });

  it("puts the piggy bank on the way to the fundraiser page", async () => {
    mockFetch(AMOUNT);
    render(
      <MemoryRouter>
        <HomePiggyBank />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Помочь сбору" });
    expect(link.getAttribute("href")).toBe("/rozhdestvenskiy-sbor");
    await waitFor(() => {
      expect(screen.getByText("3 715 ₽")).toBeTruthy();
    });
    expect(screen.getByText("Уже собрано")).toBeTruthy();
    expect(document.querySelector(".home-piggy__qr")?.getAttribute("src")).toBe(
      "/static-charity/img/qr.png",
    );
  });
});
