/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SeasonalHeroSticker from "./SeasonalHeroSticker";

vi.mock("./SeasonalThemeProvider", () => ({
  useSeasonalTheme: () => ({
    rawTheme: {
      hero_sticker: {
        title: "Рождество",
        text: "Короткая записка на главной.",
        background_color: "#fff6c8",
        title_color: "#8E2632",
        text_color: "#3b2a16",
      },
      hero_history: {
        title: "Рождество: короткая справка",
        body: "Первый абзац.\n\nВторой абзац.",
        link_label: "Узнать историю праздника",
        button_label: "Понятно",
        icon_url: "/history-icon.png",
        image_url: "/history.png",
        corner_image_url: "/history-corner.png",
        show_corners: true,
      },
    },
    theme: null,
    preferenceMode: "auto",
    seasonalEnabled: true,
  }),
}));

describe("SeasonalHeroSticker", () => {
  it("renders the history link and opens the modal with its images", () => {
    render(<SeasonalHeroSticker />);
    const link = screen.getByRole("button", { name: "Узнать историю праздника" });
    fireEvent.click(link);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Рождество: короткая справка")).toBeTruthy();
    const images = document.querySelectorAll(".seasonal-history-modal img");
    const srcs = [...images].map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/history-icon.png");
    expect(srcs).toContain("/history.png");
  });
});
