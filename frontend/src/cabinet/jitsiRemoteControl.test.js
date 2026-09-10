import { describe, expect, it, vi } from "vitest";

import {
  RC_ENDPOINT_TYPE,
  RC_STATES,
  attachOfficialRemoteControl,
  createRemoteControlMachine,
  detectRemoteControlCapability,
  parseRemoteControlEndpointText,
  serializeRemoteControlEndpoint,
} from "./jitsiRemoteControl";

describe("detectRemoteControlCapability", () => {
  it("marks a regular browser as web without native remote control", () => {
    expect(detectRemoteControlCapability({})).toEqual({
      platform: "web",
      remoteControlSupported: false,
      screenShareSupported: true,
    });
  });

  it("marks the desktop companion as capable only via explicit preload flag", () => {
    expect(detectRemoteControlCapability({
      itfluxDesktop: { isDesktopClient: true, remoteControlSupported: true },
    })).toEqual({
      platform: "desktop",
      remoteControlSupported: true,
      screenShareSupported: true,
    });
  });

  it("does not treat a window hook or userAgent as remote-control capability", () => {
    expect(detectRemoteControlCapability({
      __ITFLUX_SETUP_RC__: () => {},
      itfluxDesktop: { isDesktopClient: true },
    }).remoteControlSupported).toBe(false);
  });
});

describe("createRemoteControlMachine", () => {
  it("does not start control without a screen sharer", () => {
    const machine = createRemoteControlMachine();
    machine.request("student-1");
    expect(machine.snapshot().status).toBe(RC_STATES.IDLE);
    expect(machine.snapshot().reason).toBe("no_share");
  });

  it("goes requested → active → idle on approve and stop", () => {
    const machine = createRemoteControlMachine();
    machine.shareStarted("teacher-1");
    machine.request("student-1");
    expect(machine.snapshot().status).toBe(RC_STATES.REQUESTED);
    machine.approve();
    expect(machine.snapshot().status).toBe(RC_STATES.ACTIVE);
    expect(machine.snapshot().remoteControllerId).toBe("student-1");
    machine.beginStop();
    expect(machine.snapshot().status).toBe(RC_STATES.STOPPING);
    machine.stopped();
    expect(machine.snapshot().status).toBe(RC_STATES.IDLE);
    expect(machine.snapshot().remoteControllerId).toBe("");
  });

  it("denies a request without becoming active", () => {
    const machine = createRemoteControlMachine();
    machine.shareStarted("teacher-1");
    machine.request("student-1");
    machine.deny();
    expect(machine.snapshot().status).toBe(RC_STATES.DENIED);
    expect(machine.snapshot().remoteControllerId).toBe("");
  });

  it("ends control when screen sharing stops", () => {
    const machine = createRemoteControlMachine();
    machine.shareStarted("teacher-1");
    machine.request("student-1");
    machine.approve();
    machine.shareStopped();
    expect(machine.snapshot()).toMatchObject({
      status: RC_STATES.IDLE,
      screenSharerId: "",
      remoteControllerId: "",
    });
  });

  it("ends control when the controller leaves, keeping the share id until share stops", () => {
    const machine = createRemoteControlMachine();
    machine.shareStarted("teacher-1");
    machine.request("student-1");
    machine.approve();
    machine.participantLeft("student-1");
    expect(machine.snapshot().status).toBe(RC_STATES.IDLE);
    expect(machine.snapshot().screenSharerId).toBe("teacher-1");
    expect(machine.snapshot().remoteControllerId).toBe("");
  });

  it("ends share and control when the sharer leaves", () => {
    const machine = createRemoteControlMachine();
    machine.shareStarted("teacher-1");
    machine.request("student-1");
    machine.approve();
    machine.participantLeft("teacher-1");
    expect(machine.snapshot().status).toBe(RC_STATES.IDLE);
    expect(machine.snapshot().screenSharerId).toBe("");
  });

  it("replaces the previous session when the sharer changes", () => {
    const machine = createRemoteControlMachine();
    machine.shareStarted("teacher-1");
    machine.request("student-1");
    machine.approve();
    machine.shareStarted("teacher-2");
    expect(machine.snapshot()).toMatchObject({
      status: RC_STATES.IDLE,
      screenSharerId: "teacher-2",
      remoteControllerId: "",
      reason: "sharer_changed",
    });
  });
});

describe("endpoint text", () => {
  it("round-trips invite payloads and ignores unrelated text", () => {
    const raw = serializeRemoteControlEndpoint({
      action: "invite",
      sessionId: "s1",
      fromId: "a",
      toId: "b",
    });
    expect(parseRemoteControlEndpointText(raw)).toEqual({
      type: RC_ENDPOINT_TYPE,
      action: "invite",
      sessionId: "s1",
      fromId: "a",
      toId: "b",
    });
    expect(parseRemoteControlEndpointText("hello")).toBeNull();
    expect(parseRemoteControlEndpointText(JSON.stringify({ type: "other" }))).toBeNull();
  });
});

describe("attachOfficialRemoteControl", () => {
  it("does not attach when the companion capability is missing", () => {
    const setup = vi.fn(() => ({ dispose: vi.fn() }));
    const handle = attachOfficialRemoteControl({ executeCommand: vi.fn() }, setup, {});
    expect(handle.supported).toBe(false);
    expect(setup).not.toHaveBeenCalled();
  });

  it("passes the same api instance to setupRemoteControlRender", () => {
    const api = { executeCommand: vi.fn(), getIFrame: () => null };
    const setup = vi.fn(() => ({ dispose: vi.fn() }));
    const handle = attachOfficialRemoteControl(api, setup, {
      itfluxDesktop: { remoteControlSupported: true },
    });
    expect(handle.supported).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith(api);
  });
});
