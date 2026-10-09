/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VariantThemeSelector from "./VariantThemeSelector";
import { fetchAvailableVariantThemes } from "./variantThemeApi";

vi.mock("./variantThemeApi", () => ({
  fetchAvailableVariantThemes: vi.fn(),
}));

const themes = [
  { id: 1, name: "Путешествие", slug: "travel", layout_type: "route" },
  { id: 2, name: "Море", slug: "sea", layout_type: "route" },
];

describe("VariantThemeSelector", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("switches the selected theme instead of keeping the first", async () => {
    fetchAvailableVariantThemes.mockResolvedValue({
      can_select_variant_theme: true,
      themes,
    });
    const onChange = vi.fn();
    const view = render(<VariantThemeSelector value={null} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Тематическое" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("radio", { name: "Тематическое" }));
    expect(onChange).toHaveBeenLastCalledWith(1, themes[0]);

    view.rerender(<VariantThemeSelector value={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Море" }));
    expect(onChange).toHaveBeenLastCalledWith(2, themes[1]);

    view.rerender(<VariantThemeSelector value={2} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Море" }).className).toContain("is-selected");
    expect(screen.getByRole("button", { name: "Путешествие" }).className).not.toContain("is-selected");
  });

  it("marks the selected card when the value is a numeric string", async () => {
    fetchAvailableVariantThemes.mockResolvedValue({
      can_select_variant_theme: true,
      themes,
    });
    render(<VariantThemeSelector value="2" onChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Море" }).className).toContain("is-selected");
    });
    expect(screen.getByRole("button", { name: "Путешествие" }).className).not.toContain("is-selected");
  });
});
