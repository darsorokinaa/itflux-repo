/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectMessagingSocket } from "./live";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    FakeWebSocket.instances.push(this);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1006 });
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

describe("messaging socket identity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not open a second socket when close is delivered twice", () => {
    const disconnect = connectMessagingSocket({ onEvent: () => {}, onOpenChange: () => {} });
    const first = FakeWebSocket.instances[0];
    first.open();
    const close = first.onclose;
    first.readyState = FakeWebSocket.CLOSED;
    close?.({ code: 1006 });
    close?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    disconnect();
  });

  it("ignores close from a socket that is no longer current", () => {
    const disconnect = connectMessagingSocket({ onEvent: () => {}, onOpenChange: () => {} });
    const first = FakeWebSocket.instances[0];
    first.open();
    const staleClose = first.onclose;
    first.readyState = FakeWebSocket.CLOSED;
    staleClose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    const second = FakeWebSocket.instances[1];
    second.open();
    staleClose?.({ code: 1006 });
    vi.advanceTimersByTime(30_000);
    expect(second.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances.filter((ws) => ws.readyState === FakeWebSocket.OPEN)).toHaveLength(1);
    disconnect();
  });
});
