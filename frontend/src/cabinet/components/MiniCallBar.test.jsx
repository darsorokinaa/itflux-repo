/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MiniCallBar from "./MiniCallBar";

afterEach(() => {
  cleanup();
});

describe("MiniCallBar", () => {
  it("shows the other person or a waiting status, not a generic call title", () => {
    render(
      <MiniCallBar
        view="normal"
        statusLabel="Ждём ученика"
        waiting
        onMinimize={() => {}}
        onExpand={() => {}}
      />,
    );
    expect(screen.getByText("Ждём ученика")).toBeTruthy();
    expect(screen.queryByText(/Видеозвонок/)).toBeNull();
  });

  it("shows the peer name once they are in the call", () => {
    render(
      <MiniCallBar
        view="minimized"
        statusLabel="Алиса"
        remoteName="Алиса"
        onShow={() => {}}
      />,
    );
    expect(screen.getByText("Алиса")).toBeTruthy();
  });

  it("minimizes to a chip with a single restore action", () => {
    const onShow = vi.fn();
    render(
      <MiniCallBar
        view="minimized"
        statusLabel="Алиса"
        remoteName="Алиса"
        onShow={onShow}
      />,
    );
    expect(screen.getByText("Алиса")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Свернуть" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Открыть крупнее" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Показать видеозвонок" }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("uses a distinct action to leave the large view", () => {
    const onCompact = vi.fn();
    const onMinimize = vi.fn();
    render(
      <MiniCallBar
        view="expanded"
        statusLabel="Видеозвонок"
        onCompact={onCompact}
        onMinimize={onMinimize}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Вернуть компактный вид" }));
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Открыть крупнее" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Показать видеозвонок" })).toBeNull();
  });

  it("does not cover the video with a waiting plaque", () => {
    render(<MiniCallBar view="normal" waiting participantCount={1} onMinimize={() => {}} onExpand={() => {}} />);
    expect(screen.getByText("Ждём ученика")).toBeTruthy();
    expect(screen.queryByText(/Видеозвонок/)).toBeNull();
  });
});
