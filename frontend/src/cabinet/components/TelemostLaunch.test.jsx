import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POPUP_BLOCKED_MESSAGE, fetchTelemostJoin } from "../telemostBackup";
import { clearTelemostBackupState, getTelemostBackupState } from "../telemostBackupSession";
import TelemostLaunch from "./TelemostLaunch";

vi.mock("../telemostBackup", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchTelemostJoin: vi.fn() };
});

describe("TelemostLaunch", () => {
  beforeEach(() => {
    cleanup();
    clearTelemostBackupState();
    fetchTelemostJoin.mockReset();
    vi.stubGlobal("open", vi.fn());
  });

  it("stays hidden until the backup is available to the teacher", () => {
    const hidden = render(<TelemostLaunch available={false} canCreate meetingUuid="meeting-1" />);
    expect(hidden.container.textContent).toBe("");
    hidden.unmount();
    const noCreate = render(<TelemostLaunch available canCreate={false} meetingUuid="meeting-1" />);
    expect(noCreate.container.textContent).toBe("");
  });

  it("shows the teacher button and explains a blocked popup", () => {
    window.open.mockReturnValue(null);
    render(<TelemostLaunch available canCreate meetingUuid="meeting-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Запасной звонок: Телемост" }));
    expect(screen.getByRole("alert").textContent).toBe(POPUP_BLOCKED_MESSAGE);
    expect(fetchTelemostJoin).not.toHaveBeenCalled();
  });

  it("opens the returned link in the reserved window", async () => {
    const popup = { location: { href: "about:blank" }, focus: vi.fn(), close: vi.fn(), closed: false };
    window.open.mockReturnValue(popup);
    fetchTelemostJoin.mockResolvedValue({
      provider: "telemost",
      url: "https://telemost.yandex.ru/j/lessonRoom",
    });
    render(<TelemostLaunch available canCreate meetingUuid="meeting-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Запасной звонок: Телемост" }));
    await waitFor(() => {
      expect(popup.location.href).toBe("https://telemost.yandex.ru/j/lessonRoom");
    });
    expect(fetchTelemostJoin).toHaveBeenCalledWith("meeting-1");
    expect(popup.close).not.toHaveBeenCalled();
    expect(getTelemostBackupState().open).toBe(true);
  });

  it("closes the blank window when the link is rejected", async () => {
    const popup = { location: { href: "about:blank" }, focus: vi.fn(), close: vi.fn(), closed: false };
    window.open.mockReturnValue(popup);
    fetchTelemostJoin.mockResolvedValue({
      provider: "telemost",
      url: "https://evil.example/room",
    });
    render(<TelemostLaunch available canCreate meetingUuid="meeting-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Запасной звонок: Телемост" }));
    await waitFor(() => {
      expect(popup.close).toHaveBeenCalled();
    });
    expect(screen.getByRole("alert").textContent).toBe("Не удалось получить ссылку на видеовстречу.");
  });
});
