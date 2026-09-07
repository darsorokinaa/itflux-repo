import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardCollabSession } from "./boardCollab";

vi.mock("../../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

class RoomBroker {
  sockets: FakeWebSocket[] = [];

  attach(ws: FakeWebSocket) {
    this.sockets.push(ws);
    ws.broker = this;
  }

  broadcast(from: FakeWebSocket, payload: string) {
    for (const ws of this.sockets) {
      if (ws === from || ws.readyState !== FakeWebSocket.OPEN) continue;
      ws.onmessage?.({ data: payload } as MessageEvent);
    }
  }
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static broker: RoomBroker | null = null;

  url: string;
  readyState: number;
  sent: string[];
  broker: RoomBroker | null;
  onopen: ((ev?: Event) => void) | null;
  onclose: ((ev?: CloseEvent) => void) | null;
  onerror: ((ev?: Event) => void) | null;
  onmessage: ((ev?: MessageEvent) => void) | null;

  constructor(url: string) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.broker = FakeWebSocket.broker;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    FakeWebSocket.instances.push(this);
    this.broker?.attach(this);
  }

  send(payload: string) {
    this.sent.push(payload);
    this.broker?.broadcast(this, payload);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: "test" } as CloseEvent);
  }
}

describe("two-client board collab", () => {
  let teacher: ReturnType<typeof createBoardCollabSession> | null;
  let student: ReturnType<typeof createBoardCollabSession> | null;
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances = [];
    FakeWebSocket.broker = new RoomBroker();
    teacher = null;
    student = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
  });

  afterEach(() => {
    teacher?.close();
    student?.close();
    teacher = null;
    student = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
    FakeWebSocket.instances = [];
    FakeWebSocket.broker = null;
  });

  function openBoth() {
    const teacherOps: Array<{ id?: string; op: string }> = [];
    const studentOps: Array<{ id?: string; op: string }> = [];
    teacher = createBoardCollabSession("board-dual", "Teacher", {
      onRemoteOps: (ops) => {
        for (const op of ops.ops || []) {
          teacherOps.push({
            op: op.op,
            id: op.op === "delete" ? op.id : op.element?.id,
          });
        }
      },
    });
    student = createBoardCollabSession("board-dual", "Student", {
      onRemoteOps: (ops) => {
        for (const op of ops.ops || []) {
          studentOps.push({
            op: op.op,
            id: op.op === "delete" ? op.id : op.element?.id,
          });
        }
      },
    });
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[1].open();
    return { teacherOps, studentOps };
  }

  it("A stroke reaches B and B stroke reaches A", () => {
    const { teacherOps, studentOps } = openBoth();
    teacher?.publishLive({
      elements: [{ id: "A", version: 1, isDeleted: false, type: "freedraw" }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    expect(studentOps.some((op) => op.op === "upsert" && op.id === "A")).toBe(true);

    student?.acknowledgeRemoteElements([{ id: "A", version: 1, isDeleted: false }]);
    student?.publishLive({
      elements: [
        { id: "A", version: 1, isDeleted: false, type: "freedraw" },
        { id: "B", version: 1, isDeleted: false, type: "rectangle" },
      ],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    expect(teacherOps.some((op) => op.op === "upsert" && op.id === "B")).toBe(true);
    expect(teacherOps.some((op) => op.op === "delete" && op.id === "A")).toBe(false);
  });

  it("A delete reaches B as tombstone and does not echo back", () => {
    const { teacherOps, studentOps } = openBoth();
    teacher?.publishLive({
      elements: [{ id: "gone", version: 1, isDeleted: false, type: "ellipse" }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    student?.acknowledgeRemoteElements([{ id: "gone", version: 1, isDeleted: false }]);
    teacher?.publishLive({
      elements: [{ id: "gone", version: 2, isDeleted: true, type: "ellipse" }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    expect(studentOps.some((op) => op.id === "gone" && (op.op === "upsert" || op.op === "delete"))).toBe(true);
    const echoDelete = teacherOps.filter((op) => op.id === "gone" && op.op === "delete");
    expect(echoDelete).toHaveLength(0);
  });

  it("reconnecting B does not wipe A with an empty snapshot", () => {
    const onTeacherScene = vi.fn();
    teacher = createBoardCollabSession("board-dual", "Teacher", { onRemoteScene: onTeacherScene });
    student = createBoardCollabSession("board-dual", "Student");
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[1].open();
    teacher.publishLive({
      elements: [{ id: "keep", version: 1, isDeleted: false }],
      appState: {},
      files: {},
    });
    vi.advanceTimersByTime(30);
    const ok = student.publishSnapshot(
      { elements: [], appState: {}, files: {} },
      1,
      teacher.clientId,
    );
    expect(ok).toBe(false);
    expect(onTeacherScene).not.toHaveBeenCalled();
  });
});
