/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import SeasonalThemeDecorations from "./SeasonalThemeDecorations";

describe("SeasonalThemeDecorations", () => {
  beforeEach(() => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  });

  it("shows fade_in decorations quickly instead of the 6s loop default", () => {
    const { container } = render(
      <SeasonalThemeDecorations
        intensity="normal"
        isMobile={false}
        animationsEnabled
        pathname="/cabinet"
        decorations={[
          {
            id: 1,
            image_url: "/honey.png",
            show_desktop: true,
            show_tablet: true,
            show_mobile: true,
            animation: { type: "fade_in", speed: 6, delay: 2 },
          },
        ]}
      />,
    );
    const node = container.querySelector(".seasonal-decor");
    expect(node.style.animationDuration).toBe("0.4s");
    expect(node.style.animationDelay).toBe("0.15s");
    expect(container.querySelector("img").getAttribute("loading")).toBe("eager");
  });

  it("still shows static chrome decorations when intensity is off", () => {
    const { container } = render(
      <SeasonalThemeDecorations
        intensity="off"
        isMobile={false}
        animationsEnabled={false}
        pathname="/cabinet/meetings/1"
        heavy
        allowedZones={["top_bar", "video_meeting"]}
        className="seasonal-decor-layer--chrome"
        decorations={[
          {
            id: 1,
            image_url: "/call.png",
            zone: "video_meeting",
            show_desktop: true,
            show_tablet: true,
            show_mobile: true,
            animation: { type: "sway", speed: 6, delay: 0 },
          },
          {
            id: 2,
            image_url: "/page.png",
            zone: "page_background",
            show_desktop: true,
            show_tablet: true,
            show_mobile: true,
          },
        ]}
      />,
    );
    const layer = container.querySelector(".seasonal-decor-layer--chrome");
    expect(layer).not.toBeNull();
    expect(layer.querySelectorAll("img")).toHaveLength(1);
    expect(layer.querySelector("img").getAttribute("src")).toBe("/call.png");
    expect(container.querySelector(".seasonal-decor--sway")).toBeNull();
  });
});
