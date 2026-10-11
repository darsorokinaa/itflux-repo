import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConferenceControls, ConferenceSide } from "./ConferenceChrome";

describe("ConferenceControls", () => {
  it("reflects mute state and calls the JaaS handlers", () => {
    const onToggleMic = vi.fn();
    const onToggleCam = vi.fn();
    const onHangup = vi.fn();
    render(
      <ConferenceControls
        micOn={false}
        camOn={true}
        onToggleMic={onToggleMic}
        onToggleCam={onToggleCam}
        onHangup={onHangup}
        statusPhase="reconnecting"
        statusTitle="Восстанавливаем соединение"
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Восстанавливаем соединение");
    fireEvent.click(screen.getByRole("button", { name: "Включить микрофон" }));
    fireEvent.click(screen.getByRole("button", { name: "Выключить камеру" }));
    fireEvent.click(screen.getByRole("button", { name: "Завершить звонок" }));
    expect(onToggleMic).toHaveBeenCalledTimes(1);
    expect(onToggleCam).toHaveBeenCalledTimes(1);
    expect(onHangup).toHaveBeenCalledTimes(1);
  });
});

describe("ConferenceSide", () => {
  it("shows the local mute state and sends chat text", () => {
    const onSend = vi.fn();
    render(
      <ConferenceSide
        open
        tab="people"
        local={{ id: "me", displayName: "Дарья", audioMuted: true, roleLabel: "Организатор" }}
        remotes={[{ id: "s1", displayName: "Александр", audioMuted: false }]}
        dominantId="s1"
        onSend={onSend}
        onTab={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Дарья (вы)")).toBeTruthy();
    expect(screen.getByText("Александр")).toBeTruthy();
    expect(screen.getByText("выкл")).toBeTruthy();
  });
});
