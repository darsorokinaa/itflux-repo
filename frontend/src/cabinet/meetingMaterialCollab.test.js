import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MATERIAL_RECONNECT,
  createMeetingMaterialCollab,
  createRemoteApplyGuard,
  materialReconnectDelayMs,
} from "./meetingMaterialCollab";
import { applyMaterialOperation } from "./materials/collab";

vi.mock("../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    FakeWebSocket.instances.push(this);
  }

  send(payload) {
    this.sent.push(payload);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  error() {
    this.onerror?.();
  }
}

describe("createRemoteApplyGuard", () => {
  it("блокирует эхо во время remote apply", async () => {
    const guard = createRemoteApplyGuard();
    expect(guard.isRemote()).toBe(false);
    let seen = false;
    guard.run(() => {
      seen = guard.isRemote();
    });
    expect(seen).toBe(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(guard.isRemote()).toBe(false);
  });
});

describe("echo-safe local apply", () => {
  it("keeps per-user answers when remote page op arrives", () => {
    let state = applyMaterialOperation({}, {
      action: "field_changed",
      payload: { fieldId: "f1", value: "hello" },
      authorId: 9,
      authorRole: "student",
    });
    state = applyMaterialOperation(state, {
      action: "page_changed",
      payload: { page: 2 },
      authorId: 1,
      authorRole: "teacher",
    });
    expect(state.fields["9"].f1.value).toBe("hello");
    expect(state.page).toBe(2);
  });
});

const noJitter = () => 0.5;

describe("materialReconnectDelayMs", () => {
  it("grows exponentially and caps", () => {
    expect(materialReconnectDelayMs(1, noJitter)).toBe(1000);
    expect(materialReconnectDelayMs(2, noJitter)).toBe(1600);
    expect(materialReconnectDelayMs(3, noJitter)).toBe(2560);
    expect(materialReconnectDelayMs(4, noJitter)).toBe(4096);
    expect(materialReconnectDelayMs(5, noJitter)).toBe(6554);
    expect(materialReconnectDelayMs(6, noJitter)).toBe(8000);
    expect(materialReconnectDelayMs(99, noJitter)).toBe(8000);
  });

  it("keeps first reconnect in 800–1200ms with ±20% jitter", () => {
    expect(materialReconnectDelayMs(1, () => 0)).toBe(800);
    expect(materialReconnectDelayMs(1, () => 1)).toBe(1200);
  });

  it("never exceeds ~9.6s even with max jitter", () => {
    expect(materialReconnectDelayMs(8, () => 1)).toBe(9600);
    expect(materialReconnectDelayMs(8, () => 1)).toBeLessThanOrEqual(
      Math.round(MATERIAL_RECONNECT.MAX_MS * (1 + MATERIAL_RECONNECT.JITTER)),
    );
  });
});

describe("createMeetingMaterialCollab reconnect", () => {
  let originalWebSocket;
  let collab;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances = [];
    collab = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    collab?.close();
    collab = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
    FakeWebSocket.instances = [];
  });

  function lastSocket() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  it("reconnects once after a single close", () => {
    collab = createMeetingMaterialCollab("meet-1");
    expect(FakeWebSocket.instances).toHaveLength(1);
    lastSocket().close();
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("increases delay across consecutive failures", () => {
    collab = createMeetingMaterialCollab("meet-1");
    lastSocket().close();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().close();
    vi.advanceTimersByTime(1599);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    lastSocket().close();
    vi.advanceTimersByTime(2559);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("resets attempt after a successful open", () => {
    collab = createMeetingMaterialCollab("meet-1");
    lastSocket().close();
    vi.advanceTimersByTime(1000);
    expect(collab.getDiagnostics().reconnectAttempt).toBe(1);
    lastSocket().open();
    expect(collab.getDiagnostics().reconnectAttempt).toBe(0);
    lastSocket().close();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after close()", () => {
    collab = createMeetingMaterialCollab("meet-1");
    collab.close();
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("does not reconnect if unmount happens while a timer is pending", () => {
    collab = createMeetingMaterialCollab("meet-1");
    lastSocket().close();
    expect(FakeWebSocket.instances).toHaveLength(1);
    collab.close();
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("multiple close/error events schedule only one reconnect timer", () => {
    collab = createMeetingMaterialCollab("meet-1");
    const first = lastSocket();
    first.error();
    first.close();
    first.onclose?.();
    first.onclose?.();
    first.error();
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not open a second socket while one is already live", () => {
    collab = createMeetingMaterialCollab("meet-1");
    const first = lastSocket();
    first.open();
    first.close();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = lastSocket();
    second.open();
    const openCount = FakeWebSocket.instances.filter((ws) => ws.readyState === FakeWebSocket.OPEN).length;
    expect(openCount).toBe(1);
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances.filter((ws) => ws.readyState === FakeWebSocket.OPEN)).toHaveLength(1);
  });

  it("replaces a zombie OPEN socket after returning from background", () => {
    collab = createMeetingMaterialCollab("meet-1");
    lastSocket().open();
    expect(FakeWebSocket.instances).toHaveLength(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(MATERIAL_RECONNECT.HIDDEN_RESUME_MS + 1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });
});
