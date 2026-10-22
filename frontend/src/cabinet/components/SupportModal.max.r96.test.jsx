/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SupportModal from "./SupportModal";

afterEach(cleanup);

describe("r96 SupportModal MAX row", () => {
  it("renders MAX link with aria-label, target and rel like others", () => {
    render(<SupportModal open onClose={vi.fn()} />);
    const a = screen.getByRole("link", { name: /в MAX/ });
    expect(a.getAttribute("href")).toBe("https://max.ru/channel_itfluxacademy");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("aria-label")).toBe("Канал «Цифровой поток - онлайн-академия IT-технологий» в MAX");
    expect(screen.getByText("MAX", { selector: ".cb-support-row__label" })).toBeTruthy();
  });
});
