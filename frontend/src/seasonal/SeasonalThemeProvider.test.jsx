/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SeasonalThemeProvider, useSeasonalTheme } from "./SeasonalThemeProvider";

vi.mock("./seasonalThemeApi", async () => {
  const actual = await vi.importActual("./seasonalThemeApi");
  return {
    ...actual,
    fetchSeasonalThemeCurrent: vi.fn(),
    updateSeasonalThemePreference: vi.fn(),
    stopSeasonalThemePreview: vi.fn(),
  };
});

import {
  fetchSeasonalThemeCurrent,
  updateSeasonalThemePreference,
  buildSeasonalCssVars,
} from "./seasonalThemeApi";

function Probe() {
  const { theme, mode, animationsEnabled, openAppearancePanel } = useSeasonalTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="slug">{theme?.slug || "none"}</span>
      <span data-testid="anim">{String(animationsEnabled)}</span>
      <button type="button" onClick={openAppearancePanel}>
        open
      </button>
    </div>
  );
}

function renderWithProvider(path = "/cabinet") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SeasonalThemeProvider>
        <Probe />
      </SeasonalThemeProvider>
    </MemoryRouter>,
  );
}

describe("SeasonalThemeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-seasonal-theme");
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("applies theme via CSS variables and class", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      theme: {
        id: 1,
        name: "Новый год",
        slug: "new-year",
        background: { color: "#EEF6FF", pattern_url: null, opacity: 0.1 },
        cards: {},
        surfaces: {},
        animation: { type: "none", intensity: "minimal", max_elements: 10 },
        decorations: [],
        include_routes: [],
        exclude_routes: [],
      },
      animations_enabled: true,
      user_can_disable: true,
      available_themes: [],
      preview: { active: false },
    });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId("slug").textContent).toBe("new-year"));
    expect(document.documentElement.classList.contains("seasonal-theme-active")).toBe(true);
    expect(document.documentElement.getAttribute("data-seasonal-theme")).toBe("new-year");
    expect(document.documentElement.style.getPropertyValue("--seasonal-page-background")).toBe("#EEF6FF");
  });

  it("works without theme (default UI)", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      theme: null,
      animations_enabled: true,
      available_themes: [],
      preview: { active: false },
    });
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId("slug").textContent).toBe("none"));
    expect(document.documentElement.classList.contains("seasonal-theme-active")).toBe(false);
  });

  it("does not crash when API fails", async () => {
    fetchSeasonalThemeCurrent.mockRejectedValue(new Error("network"));
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId("slug").textContent).toBe("none"));
  });

  it("keeps theme on board route but marks heavy (effects off)", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      theme: {
        id: 1,
        name: "Snow",
        slug: "snow",
        background: { color: "#fff" },
        cards: {},
        surfaces: {},
        animation: { type: "snow", intensity: "normal", max_elements: 20 },
        decorations: [{ id: 1, image_url: "/x.png", zone: "page_background", show_desktop: true, show_tablet: true, show_mobile: true }],
        include_routes: [],
        exclude_routes: [],
      },
      animations_enabled: true,
      available_themes: [],
      preview: { active: false },
    });

    function HeavyProbe() {
      const { theme, isHeavyRoute: heavy, intensity } = useSeasonalTheme();
      return (
        <div>
          <span data-testid="slug">{theme?.slug || "none"}</span>
          <span data-testid="heavy">{String(heavy)}</span>
          <span data-testid="intensity">{intensity}</span>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={["/cabinet/boards/abc"]}>
        <SeasonalThemeProvider>
          <HeavyProbe />
        </SeasonalThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("slug").textContent).toBe("snow"));
    expect(screen.getByTestId("heavy").textContent).toBe("true");
    expect(screen.getByTestId("intensity").textContent).toBe("off");
    expect(document.querySelector(".seasonal-fx-canvas")).toBeNull();
    expect(document.querySelector(".seasonal-decor-layer")).toBeNull();
  });

  it("saves preference and updates mode", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      preference_mode: "auto",
      theme: null,
      animations_enabled: true,
      available_themes: [],
      preview: { active: false },
    });
    updateSeasonalThemePreference.mockResolvedValue({
      mode: "default",
      preference_mode: "default",
      theme: null,
      animations_enabled: false,
      available_themes: [],
      preview: { active: false },
    });

    function PrefProbe() {
      const { setPreference, mode, animationsEnabled } = useSeasonalTheme();
      return (
        <div>
          <span data-testid="mode">{mode}</span>
          <span data-testid="anim">{String(animationsEnabled)}</span>
          <button
            type="button"
            onClick={() => setPreference({ mode: "default", animations_enabled: false })}
          >
            save
          </button>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <SeasonalThemeProvider>
          <PrefProbe />
        </SeasonalThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("mode").textContent).toBe("auto"));
    screen.getByText("save").click();
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toBe("default"));
    expect(screen.getByTestId("anim").textContent).toBe("false");
  });

  it("buildSeasonalCssVars is pure and safe", () => {
    expect(buildSeasonalCssVars(undefined)).toEqual({});
  });

  it("hides appearance FAB when no seasonal themes exist", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      theme: null,
      animations_enabled: true,
      available_themes: [],
      preview: { active: false },
    });

    function AppearanceProbe() {
      const { hasSeasonalAppearance } = useSeasonalTheme();
      return <span data-testid="has-appearance">{String(hasSeasonalAppearance)}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/cabinet"]}>
        <SeasonalThemeProvider>
          <AppearanceProbe />
        </SeasonalThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("has-appearance").textContent).toBe("false"));
    expect(document.querySelector(".seasonal-appearance-fab")).toBeNull();
  });
});
