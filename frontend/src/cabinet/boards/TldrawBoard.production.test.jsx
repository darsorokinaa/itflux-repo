/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const syncCalls = [];

vi.mock("@tldraw/sync", () => ({
  useSync: (opts) => {
    syncCalls.push(opts);
    return { status: "loading" };
  },
}));

vi.mock("tldraw", () => ({
  Tldraw: () => <div data-testid="tldraw-canvas" />,
  DefaultToolbar: () => null,
  TldrawUiToolbarButton: () => null,
  BaseBoxShapeUtil: class {},
  BaseBoxShapeTool: class {},
  HTMLContainer: ({ children }) => children,
  T: { number: {}, string: {}, boolean: {}, arrayOf: () => ({}) },
  createShapePropsMigrationIds: (_type, ids) => ids,
  createShapePropsMigrationSequence: (migrations) => migrations,
  stopEventPropagation: () => {},
  useEditor: () => null,
  useValue: () => null,
  useToasts: () => ({ toasts: { get: () => [] }, addToast() {}, removeToast() {} }),
  DefaultToasts: () => null,
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
  defaultShapeUtils: [],
}));

vi.mock("tldraw/tldraw.css", () => ({}));

import TldrawBoard from "./TldrawBoard";

const BOARD = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  syncCalls.length = 0;
});

describe("TldrawBoard production", () => {
  it("opens our sync room instead of a hosted demo", () => {
    render(
      <TldrawBoard
        boardId={BOARD}
        userId={1}
        displayName="Мария"
        role="teacher"
        canEdit
      />,
    );
    expect(screen.getByText("Подключаем доску…")).toBeTruthy();
    expect(syncCalls.at(-1).roomId).toBe(BOARD);
    expect(typeof syncCalls.at(-1).uri).toBe("function");
    expect(screen.queryByText(/Демо-синхронизация/)).toBeNull();
    expect(screen.queryByTestId("tldraw-canvas")).toBeNull();
  });
});
