import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const applyAppUpdate = vi.fn();
const requestHardReload = vi.fn();

vi.mock("../utils/appUpdate", () => ({
  applyAppUpdate: (...args) => applyAppUpdate(...args),
  getAppUpdateState: () => ({ updateAvailable: true, remoteVersion: "2", localVersion: "1" }),
  subscribeAppUpdate: () => () => {},
}));

vi.mock("../utils/appUpdateGuard", () => ({
  isAppUpdateUnsafe: () => true,
}));

vi.mock("../utils/clientTelemetry", () => ({
  isChunkRecoveryBlocked: () => true,
  subscribeChunkRecoveryBlocked: (fn) => {
    fn(true);
    return () => {};
  },
}));

vi.mock("../utils/liveSessionGuard", () => ({
  isLiveSessionPath: () => true,
  requestHardReload: (...args) => requestHardReload(...args),
}));

import AppUpdateBanner from "./AppUpdateBanner";

describe("AppUpdateBanner live session", () => {
  afterEach(() => {
    cleanup();
    applyAppUpdate.mockClear();
    requestHardReload.mockClear();
  });

  it("keeps the lesson on screen and offers a manual reload", () => {
    render(<AppUpdateBanner />);
    expect(screen.getByText(/Чтобы не прерывать урок/)).toBeTruthy();
    expect(screen.getByText(/Урок не будет перезагружен автоматически/)).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Обновить" });
    fireEvent.click(buttons[0]);
    expect(applyAppUpdate).toHaveBeenCalledWith(expect.objectContaining({
      force: true,
      manual: true,
      source: "AppUpdateBanner",
    }));
    fireEvent.click(buttons[1]);
    expect(requestHardReload).toHaveBeenCalledWith(expect.objectContaining({
      manual: true,
      reason: "chunk-manual",
      source: "AppUpdateBanner",
    }));
  });
});
