import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { fetchInteractiveBoard } from "../../utils/cabinetAuth";
import { prefetchTldrawSyncToken, warmBoardEditor } from "./boardSyncPrefetch";
import { lazyWithRetry } from "../../utils/importWithRetry";
import { bindBoardDocumentTelemetry } from "./boardDocumentTelemetry";
import { normalizeBoardProvider } from "./boardProvider";
import BoardV2ErrorBoundary from "./BoardV2ErrorBoundary";
import LessonBoardMessage from "./LessonBoardMessage";
import "../styles/boards.css";
import { installBoardErrorCapture, markBoard } from "../lessonLoadTrace";

markBoard("gateModuleAt", new Date().toISOString());
installBoardErrorCapture();

/**
 * Одна реализация доски за раз. Пока флаг неизвестен, ни Excalidraw, ни tldraw не монтируются.
 * Новый lazy на каждую попытку: иначе React запоминает первый Load failed.
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

  useEffect(() => bindBoardDocumentTelemetry(boardId), [boardId]);

  useEffect(() => {
    markBoard("gateMountedAt", new Date().toISOString());
    return () => {
      markBoard("gateUnmountAt", new Date().toISOString());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Редактор и токен комнаты стартуют вместе с карточкой доски, а не после неё.
    warmBoardEditor().catch(() => {});
    prefetchTldrawSyncToken(boardId).catch(() => {});
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
  const TldrawBoard = useMemo(
    () => lazyWithRetry(() => import("./TldrawBoard")),
    [attempt],
  );
  const CabinetBoardEditorPage = useMemo(
    () => lazyWithRetry(() => import("../pages/CabinetBoardEditorPage")),
    [attempt],
  );

  useEffect(() => {
    if (phase !== "ready" || !board) return;
    markBoard("provider", normalizeBoardProvider(board.board_provider));
  }, [board, phase]);

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
