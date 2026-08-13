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
});
