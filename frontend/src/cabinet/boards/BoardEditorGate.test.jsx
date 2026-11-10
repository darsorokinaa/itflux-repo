/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mounts = vi.hoisted(() => ({ excalidraw: 0, tldraw: 0 }));
const fetchBoard = vi.hoisted(() => vi.fn());

vi.mock("../../utils/cabinetAuth", () => ({
  fetchInteractiveBoard: (...args) => fetchBoard(...args),
  fetchTldrawSyncToken: vi.fn(async () => ({ token: "test-token" })),
}));

vi.mock("../pages/CabinetBoardEditorPage", () => ({
  default: function ExcalidrawBoard() {
    mounts.excalidraw += 1;
    return <div data-testid="excalidraw-board" />;
  },
}));

vi.mock("./TldrawBoard", () => ({
  default: function TldrawBoardMock(props) {
    mounts.tldraw += 1;
    return <div data-testid="tldraw-board" data-room-id={props.boardId} />;
  },
}));

import BoardEditorGate from "./BoardEditorGate";

function renderGate() {
  return render(
    <MemoryRouter initialEntries={["/cabinet/boards/board-1"]}>
      <Routes>
        <Route path="/cabinet/boards/:boardId" element={<BoardEditorGate />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mounts.excalidraw = 0;
  mounts.tldraw = 0;
  fetchBoard.mockReset();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("BoardEditorGate", () => {
  it("mounts the excalidraw board and not tldraw", async () => {
    fetchBoard.mockResolvedValue({
      id: "board-1",
      board_provider: "excalidraw",
      viewer_user_id: 3,
      viewer_role: "teacher",
      can_edit: true,
    });
    renderGate();
    expect(await screen.findByTestId("excalidraw-board")).toBeTruthy();
    expect(screen.queryByTestId("tldraw-board")).toBeNull();
    expect(mounts.tldraw).toBe(0);
    expect(mounts.excalidraw).toBe(1);
  });

  it("mounts tldraw and not excalidraw", async () => {
    fetchBoard.mockResolvedValue({
      id: "board-1",
      board_provider: "tldraw",
      viewer_user_id: 9,
      viewer_display_name: "Илья",
      viewer_role: "student",
      can_edit: true,
    });
    renderGate();
    const board = await screen.findByTestId("tldraw-board");
    expect(board.getAttribute("data-room-id")).toBe("board-1");
    expect(screen.queryByTestId("excalidraw-board")).toBeNull();
    expect(mounts.excalidraw).toBe(0);
    expect(mounts.tldraw).toBe(1);
  });

  it("mounts neither board while the provider is unknown", () => {
    fetchBoard.mockReturnValue(new Promise(() => {}));
    renderGate();
    expect(screen.getByText("Подключаем доску…")).toBeTruthy();
    expect(screen.queryByTestId("excalidraw-board")).toBeNull();
    expect(screen.queryByTestId("tldraw-board")).toBeNull();
    expect(mounts.excalidraw).toBe(0);
    expect(mounts.tldraw).toBe(0);
  });

  it("retries a failed lookup and then opens tldraw", async () => {
    fetchBoard
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({
        id: "board-1",
        board_provider: "tldraw",
        viewer_user_id: 9,
        can_edit: true,
      });
    renderGate();
    expect(await screen.findByTestId("tldraw-board", {}, { timeout: 3000 })).toBeTruthy();
    expect(fetchBoard).toHaveBeenCalledTimes(2);
    expect(mounts.excalidraw).toBe(0);
  });

  it("shows the lookup error after repeated failures", async () => {
    fetchBoard.mockRejectedValue(new Error("down"));
    renderGate();
    expect(await screen.findByTestId("board-provider-error", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByTestId("tldraw-board")).toBeNull();
    expect(screen.queryByTestId("excalidraw-board")).toBeNull();
  });

  it("replaces the spinner when WebKit cannot import the board module", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace: vi.fn(),
    });
    sessionStorage.setItem("itflux.chunk-recover", String(Date.now()));
    fetchBoard.mockReturnValue(new Promise(() => {}));
    renderGate();
    expect(screen.getByText("Подключаем доску…")).toBeTruthy();
    const event = new Event("vite:preloadError");
    event.payload = new TypeError("Importing a module script failed.");
    window.dispatchEvent(event);
    expect(await screen.findByTestId("board-stale-module")).toBeTruthy();
    expect(screen.getByText("Доска обновилась — перезагрузите вкладку доски")).toBeTruthy();
    expect(screen.queryByText("Подключаем доску…")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Перезагрузить вкладку" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("treats a missing provider as excalidraw", async () => {
    fetchBoard.mockResolvedValue({
      id: "board-1",
      viewer_user_id: 3,
      can_edit: true,
    });
    renderGate();
    expect(await screen.findByTestId("excalidraw-board")).toBeTruthy();
    expect(screen.queryByTestId("tldraw-board")).toBeNull();
  });
});
