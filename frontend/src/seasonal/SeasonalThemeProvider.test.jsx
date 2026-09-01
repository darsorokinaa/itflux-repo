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
    writeGuestPreference: vi.fn(actual.writeGuestPreference),
  };
});

import {
  fetchSeasonalThemeCurrent,
  updateSeasonalThemePreference,
  buildSeasonalCssVars,
  readGuestPreference,
  writeGuestPreference,
  clearGuestPreference,
  readDayOverride,
  writeCachedThemePayload,
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
    localStorage.clear();
    sessionStorage.clear();
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

  it("shows chrome decorations on the meeting header", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      theme: {
        id: 1,
        name: "Honey",
        slug: "honey",
        background: { color: "#fff" },
        header: { decor_url: "/header.png", meeting_decor_url: "/meeting.png" },
        cards: {},
        surfaces: {},
        animation: { type: "snow", intensity: "normal", max_elements: 20 },
        decorations: [
          { id: 1, image_url: "/leaf.png", zone: "video_meeting", position: "top-right", show_desktop: true, show_tablet: true, show_mobile: true },
          { id: 2, image_url: "/bg.png", zone: "page_background", show_desktop: true, show_tablet: true, show_mobile: true },
        ],
        include_routes: [],
        exclude_routes: [],
      },
      animations_enabled: true,
      available_themes: [],
      preview: { active: false },
    });

    render(
      <MemoryRouter initialEntries={["/cabinet/meetings/abc"]}>
        <SeasonalThemeProvider>
          <div />
        </SeasonalThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.documentElement.classList.contains("seasonal-theme-active")).toBe(true));
    expect(document.documentElement.style.getPropertyValue("--seasonal-meeting-header-decor")).toContain("meeting.png");
    const layer = document.querySelector(".seasonal-decor-layer--chrome");
    expect(layer).not.toBeNull();
    expect(layer.querySelectorAll("img")).toHaveLength(1);
    expect(layer.querySelector("img").getAttribute("src")).toBe("/leaf.png");
    expect(document.querySelector(".seasonal-fx-canvas")).toBeNull();
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

  it("keeps FAB visibility on excluded route via rawTheme", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      preference_mode: "auto",
      theme: {
        id: 9,
        name: "Honey",
        slug: "honey",
        button_emoji: "🍯",
        background: { color: "#FFF4D6" },
        cards: {},
        surfaces: {},
        animation: { type: "none", intensity: "minimal", max_elements: 10 },
        decorations: [],
        include_routes: [],
        exclude_routes: ["/cabinet/boards"],
      },
      animations_enabled: true,
      available_themes: [{ id: 9, name: "Honey", slug: "honey", status: "active" }],
      preview: { active: false },
    });

    function AppearanceProbe() {
      const { hasSeasonalAppearance, theme, rawTheme } = useSeasonalTheme();
      return (
        <div>
          <span data-testid="has-appearance">{String(hasSeasonalAppearance)}</span>
          <span data-testid="effective">{theme?.slug || "none"}</span>
          <span data-testid="raw">{rawTheme?.slug || "none"}</span>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={["/cabinet/boards/1"]}>
        <SeasonalThemeProvider>
          <AppearanceProbe />
        </SeasonalThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("raw").textContent).toBe("honey"));
    expect(screen.getByTestId("effective").textContent).toBe("none");
    expect(screen.getByTestId("has-appearance").textContent).toBe("true");
  });

  it("preserves selected_theme_id when toggling animations only", async () => {
    clearGuestPreference();
    writeGuestPreference.mockClear();
    const themePayload = {
      id: 5,
      name: "Manual",
      slug: "manual",
      background: {},
      cards: {},
      surfaces: {},
      animation: { type: "none", intensity: "minimal" },
      decorations: [],
      include_routes: [],
      exclude_routes: [],
    };
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "manual",
      preference_mode: "manual",
      theme: themePayload,
      animations_enabled: true,
      available_themes: [{ id: 5, name: "Manual" }],
      preview: { active: false },
    });
    updateSeasonalThemePreference.mockResolvedValue({
      mode: "manual",
      preference_mode: "manual",
      theme: themePayload,
      animations_enabled: false,
      available_themes: [{ id: 5, name: "Manual" }],
      preview: { active: false },
    });

    function PrefProbe() {
      const { setPreference, animationsEnabled } = useSeasonalTheme();
      return (
        <div>
          <span data-testid="anim">{String(animationsEnabled)}</span>
          <button type="button" onClick={() => setPreference({ animations_enabled: false })}>
            toggle
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

    await waitFor(() => expect(screen.getByTestId("anim").textContent).toBe("true"));
    writeGuestPreference.mockClear();
    screen.getByText("toggle").click();
    await waitFor(() => expect(screen.getByTestId("anim").textContent).toBe("false"));
    expect(updateSeasonalThemePreference).toHaveBeenCalledWith({ animations_enabled: false });
    expect(writeGuestPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        selected_theme_id: 5,
        animations_enabled: false,
      }),
    );
  });

  it("does not overwrite non-pristine server prefs with guest localStorage", async () => {
    clearGuestPreference();
    writeGuestPreference({
      mode: "default",
      selected_theme_id: null,
      animations_enabled: true,
    });
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "manual",
      preference_mode: "manual",
      theme: {
        id: 3,
        slug: "kept",
        name: "Kept",
        background: {},
        cards: {},
        surfaces: {},
        animation: { type: "none", intensity: "minimal" },
        decorations: [],
        include_routes: [],
        exclude_routes: [],
      },
      animations_enabled: true,
      available_themes: [{ id: 3, name: "Kept" }],
      preview: { active: false },
    });

    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId("slug").textContent).toBe("kept"));
    await waitFor(() => expect(updateSeasonalThemePreference).not.toHaveBeenCalled());
    expect(readGuestPreference()).toBeNull();
  });

  it("toggles appearance off for a day without opening a panel", async () => {
    fetchSeasonalThemeCurrent.mockResolvedValue({
      mode: "auto",
      preference_mode: "auto",
      theme: {
        id: 2,
        name: "Медовый Спас",
        slug: "medovyj-spas",
        button_emoji: "🍯",
        background: { color: "#FFF4D6" },
        cards: {},
        surfaces: {},
        animation: { type: "none", intensity: "minimal" },
        decorations: [],
        include_routes: [],
        exclude_routes: [],
      },
      animations_enabled: true,
      user_can_disable: true,
      available_themes: [{ id: 2, name: "Медовый Спас", slug: "medovyj-spas" }],
      preview: { active: false },
    });
    updateSeasonalThemePreference.mockResolvedValue({
      mode: "default",
      preference_mode: "default",
      theme: null,
      animations_enabled: true,
      user_can_disable: true,
      available_themes: [{ id: 2, name: "Медовый Спас", slug: "medovyj-spas" }],
      preview: { active: false },
    });

    function ToggleProbe() {
      const { toggleAppearance, seasonalEnabled, appearanceTooltip, preferenceMode } = useSeasonalTheme();
      return (
        <div>
          <span data-testid="on">{String(seasonalEnabled)}</span>
          <span data-testid="tip">{appearanceTooltip}</span>
          <span data-testid="mode">{preferenceMode}</span>
          <button type="button" onClick={() => toggleAppearance()}>toggle</button>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <SeasonalThemeProvider>
          <ToggleProbe />
        </SeasonalThemeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("on").textContent).toBe("true"));
    expect(screen.getByTestId("tip").textContent).toBe("Тема: Медовый Спас");
    expect(document.querySelector(".seasonal-appearance-panel")).toBeNull();
    screen.getByText("toggle").click();
    await waitFor(() => expect(screen.getByTestId("mode").textContent).toBe("default"));
    expect(updateSeasonalThemePreference).toHaveBeenCalledWith({ mode: "default" });
    expect(readDayOverride()?.mode).toBe("default");
    expect(screen.getByTestId("tip").textContent).toBe("Включить: Медовый Спас");
  });

  it("applies cached theme immediately without waiting for API", async () => {
    writeCachedThemePayload({
      mode: "auto",
      preference_mode: "auto",
      theme: {
        id: 7,
        name: "Медовый Спас",
        slug: "medovyj-spas",
        background: { color: "#FFF8E7" },
        cards: {},
        surfaces: {},
        animation: { type: "leaves", intensity: "normal", max_elements: 16 },
        decorations: [],
        include_routes: [],
        exclude_routes: [],
      },
      animations_enabled: true,
      available_themes: [],
      period_themes: [],
      preview: { active: false },
    });
    let resolveFetch;
    fetchSeasonalThemeCurrent.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderWithProvider();

    expect(screen.getByTestId("slug").textContent).toBe("medovyj-spas");
    expect(document.documentElement.classList.contains("seasonal-theme-active")).toBe(true);
    expect(document.querySelector(".seasonal-fx-canvas")).not.toBeNull();

    resolveFetch({
      mode: "auto",
      preference_mode: "auto",
      theme: {
        id: 7,
        name: "Медовый Спас",
        slug: "medovyj-spas",
        background: { color: "#FFF8E7" },
        cards: {},
        surfaces: {},
        animation: { type: "leaves", intensity: "normal", max_elements: 16 },
        decorations: [],
        include_routes: [],
        exclude_routes: [],
      },
      animations_enabled: true,
      available_themes: [],
      period_themes: [],
      preview: { active: false },
    });
    await waitFor(() => expect(screen.getByTestId("slug").textContent).toBe("medovyj-spas"));
  });
});
