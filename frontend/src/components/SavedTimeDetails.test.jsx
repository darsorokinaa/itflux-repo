import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SavedTimeDetails from "./SavedTimeDetails";

const FOOTNOTE = "Это оценка, а не замер. Реальная экономия у каждого своя.";

describe("SavedTimeDetails", () => {
  it("shows breakdown and the server footnote on click", () => {
    render(
      <SavedTimeDetails
        parts={[{ key: "variant", label: "Варианты", formula: "3 × 10 мин", value: "30 мин" }]}
        footnote={FOOTNOTE}
      />,
    );
    const summary = screen.getByText("Как посчитали");
    fireEvent.click(summary);
    expect(summary.closest("details").open).toBe(true);
    expect(screen.getByText("3 × 10 мин")).toBeTruthy();
    expect(screen.getByText("30 мин")).toBeTruthy();
    expect(screen.getByText(FOOTNOTE)).toBeTruthy();
  });

  it("renders nothing without data", () => {
    const { container } = render(<SavedTimeDetails parts={[]} footnote="" />);
    expect(container.firstChild).toBeNull();
  });
});
