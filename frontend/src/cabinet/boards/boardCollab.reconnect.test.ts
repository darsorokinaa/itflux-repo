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

  it("invokes onSnapshotRequest for a peer snapshot_request", () => {
    const onSnapshotRequest = vi.fn();
    session = createBoardCollabSession("board-1", "A", { onSnapshotRequest });
    lastSocket().open();
    lastSocket().onmessage?.({
      data: JSON.stringify({ type: "snapshot_request", client_id: "other" }),
    } as MessageEvent);
    expect(onSnapshotRequest).toHaveBeenCalledWith("other");
  });

  it("does not echo snapshot_request to the requester", () => {
    const onSnapshotRequest = vi.fn();
    session = createBoardCollabSession("board-1", "A", { onSnapshotRequest });
    lastSocket().open();
    const join = lastSocket().sent.find((row) => row.includes('"join"'));
    const clientId = join ? JSON.parse(join).client_id : session.clientId;
    lastSocket().onmessage?.({
      data: JSON.stringify({ type: "snapshot_request", client_id: clientId }),
    } as MessageEvent);
    expect(onSnapshotRequest).not.toHaveBeenCalled();
  });

  it("resetPublishBase keeps the next live diff from re-echoing remote ids", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    session.publishLive({
      elements: [{ id: "local", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    session.resetPublishBase([
      { id: "local", version: 1, isDeleted: false },
      { id: "remote", version: 4, isDeleted: false },
    ]);
    session.publishLive({
      elements: [
        { id: "local", version: 1, isDeleted: false },
        { id: "remote", version: 4, isDeleted: false },
        { id: "new", version: 1, isDeleted: false },
      ],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    const opsMsgs = lastSocket().sent
      .map((row) => JSON.parse(row))
      .filter((row) => row.type === "scene_ops");
    expect(opsMsgs.length).toBeGreaterThanOrEqual(2);
    const lastOps = opsMsgs[opsMsgs.length - 1].ops.ops as Array<{
      op: string;
      element?: { id: string };
      id?: string;
    }>;
    const upsertIds = lastOps
      .filter((op) => op.op === "upsert")
      .map((op) => op.element?.id);
    expect(upsertIds).toEqual(["new"]);
    expect(upsertIds).not.toContain("remote");
  });

  it("acknowledgeRemoteElements does not swallow unpublished local strokes", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    session.publishLive({
      elements: [{ id: "local", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    session.acknowledgeRemoteElements([{ id: "remote", version: 4, isDeleted: false }]);
    session.publishLive({
      elements: [
        { id: "local", version: 1, isDeleted: false },
        { id: "unpub", version: 1, isDeleted: false },
        { id: "remote", version: 4, isDeleted: false },
      ],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    const lastOps = lastSocket().sent
      .map((row) => JSON.parse(row))
      .filter((row) => row.type === "scene_ops")
      .at(-1).ops.ops as Array<{ op: string; element?: { id: string }; id?: string }>;
    const upsertIds = lastOps.filter((op) => op.op === "upsert").map((op) => op.element?.id);
    const deleteIds = lastOps.filter((op) => op.op === "delete").map((op) => op.id);
    expect(upsertIds).toEqual(["unpub"]);
    expect(upsertIds).not.toContain("remote");
    expect(deleteIds).not.toContain("remote");
  });

  it("acknowledgeRemote during pending flush does not delete the remote id", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    session.publishLive({
      elements: [{ id: "local", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    session.publishLive({
      elements: [
        { id: "local", version: 1, isDeleted: false },
        { id: "unpub", version: 1, isDeleted: false },
      ],
      appState: {},
      files: {},
    });
    session.acknowledgeRemoteElements([{ id: "remote", version: 4, isDeleted: false }]);
    vi.advanceTimersByTime(30);
    const lastOps = lastSocket().sent
      .map((row) => JSON.parse(row))
      .filter((row) => row.type === "scene_ops")
      .at(-1).ops.ops as Array<{ op: string; element?: { id: string }; id?: string }>;
    const upsertIds = lastOps.filter((op) => op.op === "upsert").map((op) => op.element?.id);
    const deleteIds = lastOps.filter((op) => op.op === "delete").map((op) => op.id);
    expect(upsertIds).toContain("unpub");
    expect(deleteIds).not.toContain("remote");
  });

  it("publishSnapshot unicasts snapshot_response without blob files", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    session.publishSnapshot(
      {
        elements: [{ id: "img", type: "image", fileId: "f1", version: 1 }],
        appState: {},
        files: {
          f1: { dataURL: "blob:http://local/x", url: "blob:http://local/x" },
          f2: { dataURL: "/api/cabinet/interactive-boards/1/assets/f2/", url: "/api/cabinet/interactive-boards/1/assets/f2/" },
        },
      },
      3,
      "rejoin-1",
    );
    const parsed = lastSocket().sent.map((row) => JSON.parse(row));
    expect(parsed.some((row) => row.type === "scene_live")).toBe(false);
    const snap = parsed.find((row) => row.type === "snapshot_response");
    expect(snap).toBeTruthy();
    expect(snap.target_client_id).toBe("rejoin-1");
    expect(snap.scene.files.f1).toBeUndefined();
    expect(snap.scene.files.f2.dataURL).toContain("/assets/f2/");
    expect(snap.version).toBe(3);
  });

  it("applies snapshot_response only when targeted", () => {
    const onRemoteScene = vi.fn();
    session = createBoardCollabSession("board-1", "A", { onRemoteScene });
    lastSocket().open();
    const join = lastSocket().sent.find((row) => row.includes('"join"'));
    const clientId = join ? JSON.parse(join).client_id : session.clientId;
    lastSocket().onmessage?.({
      data: JSON.stringify({
        type: "snapshot_response",
        client_id: "teacher-1",
        target_client_id: "other",
        scene: { elements: [{ id: "x", version: 1 }], appState: {}, files: {} },
      }),
    } as MessageEvent);
    expect(onRemoteScene).not.toHaveBeenCalled();
    lastSocket().onmessage?.({
      data: JSON.stringify({
        type: "snapshot_response",
        client_id: "teacher-1",
        target_client_id: clientId,
        scene: { elements: [{ id: "x", version: 1 }], appState: {}, files: {} },
      }),
    } as MessageEvent);
    expect(onRemoteScene).toHaveBeenCalledTimes(1);
  });

  it("ignores scene_live snapshot flag unless awaiting reconnect snapshot", () => {
    const onRemoteScene = vi.fn();
    session = createBoardCollabSession("board-1", "A", { onRemoteScene });
    lastSocket().open();
    lastSocket().onmessage?.({
      data: JSON.stringify({
        type: "scene_live",
        client_id: "teacher-1",
        snapshot: true,
        scene: { elements: [{ id: "x", version: 1 }], appState: {}, files: {} },
      }),
    } as MessageEvent);
    expect(onRemoteScene).not.toHaveBeenCalled();
    lastSocket().onmessage?.({
      data: JSON.stringify({
        type: "scene_live",
        client_id: "teacher-1",
        scene: { elements: [{ id: "x", version: 1 }], appState: {}, files: {} },
      }),
    } as MessageEvent);
    expect(onRemoteScene).toHaveBeenCalledTimes(1);
  });

  function mutationMsgs() {
    return lastSocket().sent
      .map((row) => JSON.parse(row))
      .filter((row) =>
        row.type === "scene_ops"
        || row.type === "scene_live"
        || row.type === "file_add"
        || row.type === "snapshot_response",
      );
  }

  it("remote apply does not echo as outbound ops", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    session.publishLive({
      elements: [{ id: "s", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    const afterLocal = mutationMsgs().length;
    session.acknowledgeRemoteElements([{ id: "y", version: 2, isDeleted: false }]);
    session.publishLive({
      elements: [
        { id: "s", version: 1, isDeleted: false },
        { id: "y", version: 2, isDeleted: false },
      ],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    expect(mutationMsgs().length).toBe(afterLocal);
  });

  it("snapshot_response does not echo a full scene publish", () => {
    const onRemoteScene = vi.fn((scene: { elements: unknown[] }) => {
      session?.acknowledgeRemoteElements(scene.elements);
    });
    session = createBoardCollabSession("board-1", "A", { onRemoteScene });
    lastSocket().open();
    const join = lastSocket().sent.find((row) => row.includes('"join"'));
    const clientId = join ? JSON.parse(join).client_id : session.clientId;
    session.publishLive({
      elements: [{ id: "s", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    const afterLocal = mutationMsgs().length;
    lastSocket().onmessage?.({
      data: JSON.stringify({
        type: "snapshot_response",
        client_id: "editor-1",
        target_client_id: clientId,
        scene: {
          elements: [
            { id: "s", version: 1, isDeleted: false },
            { id: "y", version: 2, isDeleted: false },
          ],
          appState: {},
          files: {},
        },
      }),
    } as MessageEvent);
    expect(onRemoteScene).toHaveBeenCalledTimes(1);
    session.publishLive({
      elements: [
        { id: "s", version: 1, isDeleted: false },
        { id: "y", version: 2, isDeleted: false },
      ],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    expect(mutationMsgs().some((row) => row.type === "snapshot_response")).toBe(false);
    expect(mutationMsgs().length).toBe(afterLocal);
  });

  it("reconnect keeps local pending X and remote Y without spurious delete", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    const sceneS = [{ id: "s", version: 1, isDeleted: false, type: "freedraw" }];
    session.publishLive({ elements: sceneS, appState: {}, files: {} });
    vi.advanceTimersByTime(30);
    session.acknowledgeRemoteElements([
      { id: "s", version: 1, isDeleted: false, type: "freedraw" },
      { id: "y", version: 1, isDeleted: false, type: "text", text: "peer" },
    ]);
    session.publishLive({
      elements: [
        { id: "s", version: 1, isDeleted: false, type: "freedraw" },
        { id: "x", version: 1, isDeleted: false, type: "rectangle" },
        { id: "y", version: 1, isDeleted: false, type: "text", text: "peer" },
      ],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    const lastOps = mutationMsgs().filter((row) => row.type === "scene_ops").at(-1).ops.ops as Array<{
      op: string;
      element?: { id: string };
      id?: string;
    }>;
    const upsertIds = lastOps.filter((op) => op.op === "upsert").map((op) => op.element?.id);
    const deleteIds = lastOps.filter((op) => op.op === "delete").map((op) => op.id);
    expect(upsertIds).toEqual(["x"]);
    expect(deleteIds).not.toContain("y");
    expect(deleteIds).not.toContain("s");
  });

  it("reconnect image pending is published once without echoing remote file element", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    session.publishLive({
      elements: [{ id: "s", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    session.acknowledgeRemoteElements([
      { id: "s", version: 1, isDeleted: false },
      { id: "imgY", version: 1, type: "image", fileId: "fy" },
    ]);
    session.publishLive({
      elements: [
        { id: "s", version: 1, isDeleted: false },
        { id: "imgX", version: 1, type: "image", fileId: "fx" },
        { id: "imgY", version: 1, type: "image", fileId: "fy" },
      ],
      appState: {},
      files: {
        fx: { dataURL: "/api/cabinet/interactive-boards/1/assets/fx/" },
      },
    });
    vi.advanceTimersByTime(30);
    const lastOps = mutationMsgs().filter((row) => row.type === "scene_ops").at(-1).ops.ops as Array<{
      op: string;
      element?: { id: string };
    }>;
    expect(lastOps.filter((op) => op.op === "upsert").map((op) => op.element?.id)).toEqual(["imgX"]);
  });

  it("rapid publishLive coalesces instead of one message per pointermove", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    for (let i = 1; i <= 40; i += 1) {
      session.publishLive({
        elements: [{ id: "stroke", version: i, points: Array.from({ length: i }, (_, n) => [n, n]) }],
        appState: {},
        files: {},
      });
    }
    vi.advanceTimersByTime(30);
    const ops = mutationMsgs().filter((row) => row.type === "scene_ops" || row.type === "scene_live");
    expect(ops.length).toBeLessThanOrEqual(2);
    expect(ops.length).toBeGreaterThanOrEqual(1);
  });

  it("repeated close/create does not leak sockets after close()", () => {
    for (let i = 0; i < 5; i += 1) {
      session?.close();
      session = createBoardCollabSession("board-1", `A${i}`);
      lastSocket().open();
      lastSocket().close();
      vi.advanceTimersByTime(1000);
      lastSocket().open();
      session.close();
    }
    vi.advanceTimersByTime(30_000);
    const open = FakeWebSocket.instances.filter((ws) => ws.readyState === FakeWebSocket.OPEN);
    expect(open).toHaveLength(0);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(5);
  });

  it("closes a zombie OPEN socket after pageshow when ping is not acked", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    expect(FakeWebSocket.instances).toHaveLength(1);
    window.dispatchEvent(new Event("pageshow"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastSocket().sent.some((row) => row.includes('"ping"'))).toBe(true);
    vi.advanceTimersByTime(BOARD_RECONNECT.PING_ACK_MS + 1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("keeps the socket if resume ping is acked", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    window.dispatchEvent(new Event("pageshow"));
    lastSocket().onmessage?.({
      data: JSON.stringify({ type: "pong", t: Date.now() }),
    } as MessageEvent);
    vi.advanceTimersByTime(BOARD_RECONNECT.PING_ACK_MS + 1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastSocket().readyState).toBe(FakeWebSocket.OPEN);
  });

  it("coalesces pageshow + visibility + focus into one reconnect", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(BOARD_RECONNECT.HIDDEN_RESUME_MS + 1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("stops auto-reconnect after MAX_ATTEMPT and reports failed", () => {
    const onStatus = vi.fn();
    session = createBoardCollabSession("board-1", "A", { onStatus });
    for (let i = 0; i <= BOARD_RECONNECT.MAX_ATTEMPT + 1; i += 1) {
      lastSocket().close();
      vi.advanceTimersByTime(10_000);
    }
    expect(onStatus).toHaveBeenCalledWith("failed");
    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(20_000);
    expect(FakeWebSocket.instances.length).toBe(before);
  });

  it("reconnectNow tears down a live socket and opens a new one", () => {
    session = createBoardCollabSession("board-1", "A");
    lastSocket().open();
    session.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });
});
