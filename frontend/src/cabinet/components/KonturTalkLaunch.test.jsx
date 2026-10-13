import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchKonturTalkJoin } from "../../utils/cabinetAuth";
import { POPUP_BLOCKED_MESSAGE } from "../konturTalk";
import KonturTalkLaunch from "./KonturTalkLaunch";

vi.mock("../../utils/cabinetAuth", () => ({
  fetchKonturTalkJoin: vi.fn(),
}));

describe("KonturTalkLaunch", () => {
  beforeEach(() => {
    cleanup();
    fetchKonturTalkJoin.mockReset();
    vi.stubGlobal("open", vi.fn());
  });

  it("stays hidden until the provider is available", () => {
    const { container } = render(<KonturTalkLaunch available={false} meetingUuid="meeting-1" />);
    expect(container.textContent).toBe("");
  });

  it("shows the open button only after Контур.Толк is selected", () => {
    render(<KonturTalkLaunch available meetingUuid="meeting-1" />);
    expect(screen.queryByRole("button", { name: "Открыть видеовстречу" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Контур.Толк" }));
    expect(screen.getByRole("button", { name: "Открыть видеовстречу" })).toBeTruthy();
  });

  it("explains a blocked popup and does not request a link", () => {
    window.open.mockReturnValue(null);
    render(<KonturTalkLaunch available meetingUuid="meeting-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Контур.Толк" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть видеовстречу" }));
    expect(screen.getByRole("alert").textContent).toBe(POPUP_BLOCKED_MESSAGE);
    expect(fetchKonturTalkJoin).not.toHaveBeenCalled();
  });

  it("opens the django link in the reserved tab", async () => {
    const popup = { location: { href: "about:blank" }, opener: {}, close: vi.fn() };
    window.open.mockReturnValue(popup);
    fetchKonturTalkJoin.mockResolvedValue({
      provider: "kontur_talk",
      url: "https://itflux.ktalk.ru/itflux-abc",
    });
    render(<KonturTalkLaunch available meetingUuid="meeting-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Контур.Толк" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть видеовстречу" }));
    await waitFor(() => {
      expect(popup.location.href).toBe("https://itflux.ktalk.ru/itflux-abc");
    });
    expect(fetchKonturTalkJoin).toHaveBeenCalledWith("meeting-1");
    expect(popup.close).not.toHaveBeenCalled();
  });

  it("closes the blank tab when the link is rejected", async () => {
    const popup = { location: { href: "about:blank" }, opener: {}, close: vi.fn() };
    window.open.mockReturnValue(popup);
    fetchKonturTalkJoin.mockResolvedValue({
      provider: "kontur_talk",
      url: "https://evil.example/room",
    });
    render(<KonturTalkLaunch available meetingUuid="meeting-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Контур.Толк" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть видеовстречу" }));
    await waitFor(() => {
      expect(popup.close).toHaveBeenCalled();
    });
    expect(popup.location.href).toBe("about:blank");
    expect(screen.getByRole("alert").textContent).toBe("Не удалось получить ссылку на видеовстречу.");
  });
});
