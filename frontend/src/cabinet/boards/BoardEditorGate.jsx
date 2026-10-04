import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { fetchInteractiveBoard } from "../../utils/cabinetAuth";
import { normalizeBoardProvider } from "./boardProvider";
import BoardV2ErrorBoundary from "./BoardV2ErrorBoundary";
import LessonBoardMessage from "./LessonBoardMessage";
import "../styles/boards.css";

const TldrawBoard = lazy(() => import("./TldrawBoard"));
const CabinetBoardEditorPage = lazy(() => import("../pages/CabinetBoardEditorPage"));

/**
 * Одна реализация доски за раз. Пока флаг неизвестен, ни Excalidraw, ни tldraw не монтируются.
 */
export default function BoardEditorGate() {
  const { boardId = "" } = useParams();
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState({
    boardId: "",
    attempt: -1,
    phase: "loading",
    board: null,
  });

  useEffect(() => {
    let cancelled = false;
    // Короткий повтор: runserver на секунду отваливается при перезапуске,
    // а обрезанный JSON при 200 иначе навсегда остаётся этой ошибкой.
    const delays = [0, 300, 900];

    async function load() {
      for (let index = 0; index < delays.length; index += 1) {
        if (delays[index] > 0) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, delays[index]);
          });
        }
        if (cancelled) return;
        try {
          const data = await fetchInteractiveBoard(boardId);
          if (cancelled) return;
          if (data && typeof data === "object") {
            setRequest({ boardId, attempt, phase: "ready", board: data });
            return;
          }
        } catch {
          /* следующий заход */
        }
      }
      if (!cancelled) {
        setRequest({ boardId, attempt, phase: "error", board: null });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [boardId, attempt]);

  const phase = request.boardId === boardId && request.attempt === attempt ? request.phase : "loading";
  const board = phase === "ready" ? request.board : null;

  if (phase === "loading") {
    return (
      <div className="cb-board-editor lesson-board-shell" data-testid="board-provider-pending">
        <div className="lesson-board">
          <LessonBoardMessage text="Подключаем доску…" />
        </div>
      </div>
    );
  }

  if (phase === "error" || !board) {
    return (
      <div className="cb-board-editor lesson-board-shell" data-testid="board-provider-error">
        <div className="lesson-board">
          <LessonBoardMessage
            title="Не удалось подключить доску"
            text="Не получилось узнать, какую доску открыть. Урок при этом не закрывается."
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </div>
      </div>
    );
  }

  if (normalizeBoardProvider(board.board_provider) === "tldraw") {
    return (
      <BoardV2ErrorBoundary onRetry={() => setAttempt((value) => value + 1)}>
        <Suspense
          fallback={(
            <div className="cb-board-editor lesson-board-shell">
              <div className="lesson-board">
                <LessonBoardMessage text="Подключаем доску…" />
              </div>
            </div>
          )}
        >
          <TldrawBoard
            key={attempt}
            boardId={board.id || boardId}
            userId={board.viewer_user_id}
            displayName={board.viewer_display_name}
            role={board.viewer_role}
            avatarUrl={board.viewer_avatar_url}
            canEdit={Boolean(board.can_edit)}
          />
        </Suspense>
      </BoardV2ErrorBoundary>
    );
  }

  return (
    <Suspense
      fallback={(
        <div className="cb-board-editor lesson-board-shell">
          <div className="lesson-board">
            <LessonBoardMessage text="Подключаем доску…" />
          </div>
        </div>
      )}
    >
      <CabinetBoardEditorPage />
    </Suspense>
  );
}
