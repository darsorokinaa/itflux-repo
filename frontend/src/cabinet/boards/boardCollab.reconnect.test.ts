import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOARD_RECONNECT,
  boardReconnectDelayMs,
  createBoardCollabSession,
} from "./boardCollab";

vi.mock("../../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState: number;
  sent: string[];
  onopen: ((ev?: Event) => void) | null;
  onclose: ((ev?: CloseEvent) => void) | null;
  onerror: ((ev?: Event) => void) | null;
  onmessage: ((ev?: MessageEvent) => void) | null;

  constructor(url: string) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: "test" } as CloseEvent);
  }
}

const noJitter = () => 0.5;

describe("boardReconnectDelayMs", () => {
  it("grows exponentially and caps", () => {
    expect(boardReconnectDelayMs(1, noJitter)).toBe(1000);
    expect(boardReconnectDelayMs(2, noJitter)).toBe(1600);
    expect(boardReconnectDelayMs(6, noJitter)).toBe(8000);
    expect(boardReconnectDelayMs(99, noJitter)).toBe(8000);
  });
});

describe("createBoardCollabSession reconnect", () => {
  let originalWebSocket: typeof WebSocket;
  let session: ReturnType<typeof createBoardCollabSession> | null;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances = [];
    session = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    session?.close();
    session = null;
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
    session = createBoardCollabSession("board-1", "A");
    expect(FakeWebSocket.instances).toHaveLength(1);
    lastSocket().close();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not open a second socket while one is already live", () => {
    session = createBoardCollabSession("board-1", "A");
    const first = lastSocket();
    first.open();
    first.close();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().open();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances.filter((ws) => ws.readyState === FakeWebSocket.OPEN)).toHaveLength(1);
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("multiple close events schedule only one reconnect timer", () => {
    session = createBoardCollabSession("board-1", "A");
    const first = lastSocket();
    first.close();
    first.onclose?.({ code: 1006 } as CloseEvent);
    first.onclose?.({ code: 1006 } as CloseEvent);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("does not reconnect after close()", () => {
    session = createBoardCollabSession("board-1", "A");
    session.close();
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("replaces a zombie OPEN socket after returning from background", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    expect(FakeWebSocket.instances).toHaveLength(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(BOARD_RECONNECT.HIDDEN_RESUME_MS + 1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("requests a snapshot after reconnect", () => {
    const onResync = vi.fn();
    session = createBoardCollabSession("board-1", "A", { onResyncNeeded: onResync });
    lastSocket().open();
    lastSocket().close();
    vi.advanceTimersByTime(1000);
    lastSocket().open();
    expect(onResync).toHaveBeenCalledTimes(1);
    const snapshot = lastSocket().sent.some((row) => row.includes("snapshot_request"));
    expect(snapshot).toBe(true);
  });
});
