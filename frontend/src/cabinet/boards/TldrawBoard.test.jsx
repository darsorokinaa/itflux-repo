/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const syncCalls = [];
let syncResult = { status: "loading" };
let explode = false;

vi.mock("@tldraw/sync", () => ({
  useSync: (opts) => {
    syncCalls.push({
      roomId: opts.roomId,
      users: opts.users,
      shapeUtils: opts.shapeUtils,
      uri: opts.uri,
      assets: opts.assets,
      getUserPresence: opts.getUserPresence,
    });
    return syncResult;
  },
}));

vi.mock("@tldraw/state", () => ({
  computed: (_name, fn) => ({ get: () => fn() }),
}));

vi.mock("@tldraw/tlschema", () => ({
  createUserId: (id) => `user:${id}`,
  UserRecordType: {
    create: (row) => row,
  },
  getDefaultUserPresence: () => null,
  geoShapeMigrations: { sequence: [] },
}));

vi.mock("tldraw", () => ({
  Tldraw: ({ licenseKey }) => {
    if (explode) throw new Error("tldraw failed");
    return <div data-testid="tldraw-canvas" data-license={licenseKey || ""} />;
  },
  DefaultToolbar: ({ children }) => <div>{children}</div>,
  TldrawUiToolbarButton: ({ children }) => <button type="button">{children}</button>,
  BaseBoxShapeUtil: class {},
  BaseBoxShapeTool: class {},
  HTMLContainer: ({ children }) => children,
  Rectangle2d: class {},
  T: { number: {}, string: {}, boolean: {}, arrayOf: () => ({}) },
  createShapePropsMigrationIds: (_type, ids) => ids,
  createShapePropsMigrationSequence: (migrations) => migrations,
  stopEventPropagation: () => {},
  useEditor: () => null,
  useValue: (_name, fn) => (typeof fn === "function" ? fn() : null),
  useTools: () => ({}),
  useIsToolSelected: () => false,
  HighlightShapeUtil: { configure: () => class HighlightShapeUtil {} },
  NoteShapeUtil: class NoteShapeUtil {
    static type = "note";
    getHandles() { return []; }
  },
  GeoShapeUtil: class GeoShapeUtil {
    static type = "geo";
  },
  defaultShapeUtils: [{ type: "geo" }, { type: "arrow" }],
}));

vi.mock("tldraw/tldraw.css", () => ({}));

import { lessonBoardComponents } from "./lessonBoardUi";
import TldrawBoard, { shouldResumeTldrawRoom } from "./TldrawBoard";

const BOARD = "11111111-1111-4111-8111-111111111111";

function boardTree(props = {}) {
  return (
    <div>
      <span>Видеозвонок</span>
      <TldrawBoard
        boardId={BOARD}
        userId={7}
        displayName="Анна"
        role="student"
        canEdit
        {...props}
      />
    </div>
  );
}

afterEach(() => {
  cleanup();
  syncCalls.length = 0;
  syncResult = { status: "loading" };
  explode = false;
  document.documentElement.className = "";
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("tldraw room resume", () => {
  it("reconnects the same room after wake without a manual reload", () => {
    expect(shouldResumeTldrawRoom({ visibilityState: "visible", status: "error", stalled: false })).toBe(true);
    expect(shouldResumeTldrawRoom({ visibilityState: "visible", status: "synced-remote", stalled: true })).toBe(true);
    expect(shouldResumeTldrawRoom({ visibilityState: "hidden", status: "error", stalled: true })).toBe(false);
    expect(shouldResumeTldrawRoom({ visibilityState: "visible", status: "synced-remote", stalled: false })).toBe(false);
  });
});

describe("TldrawBoard", () => {
  it("replaces the default tldraw panels with one lesson shell", () => {
    expect(lessonBoardComponents.StylePanel).toBeNull();
    expect(lessonBoardComponents.NavigationPanel).toBeNull();
    expect(lessonBoardComponents.QuickActions).toBeNull();
    expect(lessonBoardComponents.Minimap).toBeNull();
    expect(lessonBoardComponents.Toolbar).toBeNull();
    expect(typeof lessonBoardComponents.InFrontOfTheCanvas).toBe("function");
    expect(lessonBoardComponents.ContextMenu).toBeUndefined();
  });

  it("keeps the same room id when react rerenders", () => {
    const view = render(boardTree());
    view.rerender(boardTree());
    expect(syncCalls.length).toBeGreaterThan(0);
    expect(syncCalls.every((call) => call.roomId === BOARD)).toBe(true);
    expect(syncCalls[0].shapeUtils.map((util) => util.type)).toEqual(["geo", "arrow", "formula", "graph", "task"]);
    expect(typeof syncCalls[0].uri).toBe("function");
    expect(typeof syncCalls[0].assets.upload).toBe("function");
    expect(typeof syncCalls[0].getUserPresence).toBe("function");
    expect(screen.getByTestId("tldraw-board").getAttribute("data-room-id")).toBe(BOARD);
  });

  it("opens another room for another board", () => {
    render(boardTree({ boardId: "22222222-2222-4222-8222-222222222222" }));
    expect(syncCalls.at(-1).roomId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("shows the canvas only after sync connects", () => {
    const view = render(boardTree());
    expect(screen.getByText("Подключаем доску…")).toBeTruthy();
    expect(screen.queryByTestId("tldraw-canvas")).toBeNull();
    syncResult = { status: "synced-remote", store: { ok: true } };
    view.rerender(boardTree());
    expect(screen.getByTestId("tldraw-canvas")).toBeTruthy();
    expect(screen.queryByTestId("excalidraw-board")).toBeNull();
  });

  it("stops waiting when the board connection never answers", () => {
    vi.useFakeTimers();
    render(boardTree());
    expect(screen.getByText("Подключаем доску…")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByText("Не удалось подключить доску")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("offers a retry when sync fails and does not drop the lesson chrome", () => {
    syncResult = { status: "error", error: new Error("offline") };
    render(boardTree());
    expect(screen.getByText("Не удалось подключить доску")).toBeTruthy();
    expect(screen.getByText("Видеозвонок")).toBeTruthy();
    const before = syncCalls.length;
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(syncCalls.length).toBeGreaterThan(before);
    expect(syncCalls.every((call) => call.roomId === BOARD)).toBe(true);
  });

  it("sends a stable user id and display name, not an email", () => {
    render(boardTree({ displayName: "teacher@school.test", role: "teacher", userId: 4 }));
    const user = syncCalls.at(-1).users.currentUser.get();
    expect(user.id).toBe("user:4");
    expect(user.name).toBe("Учитель");
    expect(user.name).not.toContain("@");
    expect(user.color).toBe("#2563eb");
  });

  it("releases the page scroll lock on unmount", () => {
    const view = render(boardTree());
    expect(document.documentElement.classList.contains("cb-board-editor-open")).toBe(true);
    view.unmount();
    expect(document.documentElement.classList.contains("cb-board-editor-open")).toBe(false);
    expect(document.documentElement.classList.contains("cb-board-editor-iframe")).toBe(false);
  });

  it("keeps the lesson marker when tldraw throws", () => {
    syncResult = { status: "synced-remote", store: { ok: true } };
    explode = true;
    render(boardTree());
    expect(screen.getByText("Не удалось подключить доску")).toBeTruthy();
    expect(screen.getByText("Видеозвонок")).toBeTruthy();
    expect(screen.queryByTestId("tldraw-canvas")).toBeNull();
    explode = false;
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(screen.getByTestId("tldraw-canvas")).toBeTruthy();
  });
});
