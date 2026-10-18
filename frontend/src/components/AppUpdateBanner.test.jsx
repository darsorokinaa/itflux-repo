import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const applyAppUpdate = vi.fn();
const requestHardReload = vi.fn();
const env = { live: true, chunk: true };

vi.mock("../utils/appUpdate", () => ({
  applyAppUpdate: (...args) => applyAppUpdate(...args),
  getAppUpdateState: () => ({ updateAvailable: true, remoteVersion: "2", localVersion: "1" }),
  subscribeAppUpdate: () => () => {},
}));

vi.mock("../utils/appUpdateGuard", () => ({
  isAppUpdateUnsafe: () => true,
}));

vi.mock("../utils/clientTelemetry", () => ({
  isChunkRecoveryBlocked: () => env.chunk,
  subscribeChunkRecoveryBlocked: (fn) => {
    fn(env.chunk);
    return () => {};
  },
}));

vi.mock("../utils/liveSessionGuard", () => ({
  isLiveSessionPath: () => env.live,
  requestHardReload: (...args) => requestHardReload(...args),
}));

import AppUpdateBanner from "./AppUpdateBanner";

afterEach(() => {
  cleanup();
  applyAppUpdate.mockClear();
  requestHardReload.mockClear();
  env.live = true;
  env.chunk = true;
});

describe("AppUpdateBanner live session", () => {
  it("keeps the chunk-recovery notice in a lesson and offers a manual reload", () => {
    render(<AppUpdateBanner />);
    expect(screen.getByText(/Урок не будет перезагружен автоматически/)).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Обновить" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(requestHardReload).toHaveBeenCalledWith(expect.objectContaining({
      manual: true,
      reason: "chunk-manual",
      source: "AppUpdateBanner",
    }));
    expect(screen.getByTestId("app-update-banner-stack").className)
      .toContain("itflux-update-banner-stack--live");
  });

  it("does not put the new-version banner over the lesson material (r73)", () => {
    env.chunk = false;
    render(<AppUpdateBanner />);
    expect(screen.queryByText(/новая версия платформы/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Обновить" })).toBeNull();
  });
});

describe("AppUpdateBanner outside a lesson", () => {
  it("offers the update on a regular page", () => {
    env.live = false;
    env.chunk = false;
    render(<AppUpdateBanner />);
    expect(screen.getByText(/новая версия платформы/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(applyAppUpdate).toHaveBeenCalledWith(expect.objectContaining({
      force: true,
      manual: true,
      source: "AppUpdateBanner",
    }));
  });

  it("is not rendered inside an iframe (variant opened in the lesson room)", () => {
    env.live = false;
    env.chunk = false;
    const original = Object.getOwnPropertyDescriptor(window, "top");
    Object.defineProperty(window, "top", { configurable: true, get: () => ({}) });
    try {
      render(<AppUpdateBanner />);
      expect(screen.queryByText(/новая версия платформы/)).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, "top", original);
    }
  });
});
