/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MiniCallBar from "./MiniCallBar";

afterEach(() => cleanup());

describe("MiniCallBar «поверх окон» (r72)", () => {
  it("hides the button when the browser cannot do PiP", () => {
    render(<MiniCallBar view="normal" statusLabel="Алиса" onTogglePip={() => {}} />);
    expect(screen.queryByLabelText("Видео поверх окон")).toBeNull();
  });

  it("toggles PiP and reflects the state", () => {
    const onTogglePip = vi.fn();
    const { rerender } = render(
      <MiniCallBar view="normal" statusLabel="Алиса" pipAvailable onTogglePip={onTogglePip} />,
    );
    fireEvent.click(screen.getByLabelText("Видео поверх окон"));
    expect(onTogglePip).toHaveBeenCalledTimes(1);
    rerender(<MiniCallBar view="normal" statusLabel="Алиса" pipAvailable pipActive onTogglePip={onTogglePip} />);
    expect(screen.getByLabelText("Убрать видео поверх окон").getAttribute("aria-pressed")).toBe("true");
  });
});
