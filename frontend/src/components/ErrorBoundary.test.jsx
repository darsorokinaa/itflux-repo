import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

vi.mock("../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

function Boom() {
  throw new Error("LessonRoom exploded");
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders fallback instead of a blank screen", () => {
    render(
      <ErrorBoundary kind="room">
        <Boom />
      </ErrorBoundary>,
    );
    const fallback = screen.getByTestId("app-error-fallback");
    expect(fallback.textContent).toContain("Не удалось открыть урок");
    expect(screen.getByTestId("app-error-retry")).toBeTruthy();
    expect(screen.getByTestId("app-error-reload")).toBeTruthy();
    expect(screen.getByTestId("app-error-home")).toBeTruthy();
  });

  it("retry remounts children after a render crash", () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("once");
      return <p>recovered</p>;
    }
    render(
      <ErrorBoundary kind="app">
        <Flaky />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByTestId("app-error-retry"));
    expect(screen.getByText("recovered")).toBeTruthy();
  });
});
