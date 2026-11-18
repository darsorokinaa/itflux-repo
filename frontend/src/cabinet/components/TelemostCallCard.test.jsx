import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IFRAME_NOTE, fetchTelemostJoin, fetchTelemostStatus } from "../telemostBackup";
import { clearTelemostBackupState, setTelemostBackupState } from "../telemostBackupSession";
import TelemostCallCard from "./TelemostCallCard";

vi.mock("../telemostBackup", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchTelemostJoin: vi.fn(), fetchTelemostStatus: vi.fn() };
});

describe("TelemostCallCard", () => {
  beforeEach(() => {
    cleanup();
    clearTelemostBackupState();
    fetchTelemostJoin.mockReset();
    fetchTelemostStatus.mockReset();
    fetchTelemostStatus.mockResolvedValue({ available: false, open: false, canCreate: false });
    vi.stubGlobal("open", vi.fn());
  });

  it("is hidden until the backup call is open", () => {
    const { container } = render(<TelemostCallCard />);
    expect(container.textContent).toBe("");
  });

  it("shows the floating card for teacher and student once open", async () => {
    setTelemostBackupState({
      meetingUuid: "meeting-1",
      available: true,
      open: true,
      canCreate: false,
    });
    fetchTelemostStatus.mockResolvedValue({
      available: true,
      open: true,
      canCreate: false,
    });
    const popup = { location: { href: "about:blank" }, focus: vi.fn(), close: vi.fn(), closed: false };
    window.open.mockReturnValue(popup);
    fetchTelemostJoin.mockResolvedValue({
      provider: "telemost",
      url: "https://telemost.yandex.ru/j/lessonRoom",
    });
    render(<TelemostCallCard meetingUuid="meeting-1" />);
    expect(screen.getByText("Идёт запасной звонок в Телемосте")).toBeTruthy();
    expect(screen.getByText(IFRAME_NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Открыть звонок в Телемосте" }));
    await waitFor(() => {
      expect(popup.location.href).toBe("https://telemost.yandex.ru/j/lessonRoom");
    });
  });
});
