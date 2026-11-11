import { useState } from "react";
import { variantBoardFrameSrc } from "./variantBoardSplitSync";

export default function StudentSplitChrome({
  split, collapsed, onCollapse, onExpand, width, isMobile, dragging, onDragStart,
}) {
  const boardId = split?.boardId || "";
  const [tabState, setTabState] = useState({ boardId, tab: "board" });
  const tab = tabState.boardId === boardId ? tabState.tab : "board";
  const setTab = (next) => setTabState({ boardId, tab: next });
  if (!split) return null;
  if (collapsed) {
    return (
      <button type="button" className="vb-toggle" onClick={onExpand} data-testid="variant-board-show">
        Показать доску
      </button>
    );
  }
  const title = split.kind === "group" ? "Доска группы" : "Доска";
  const hidePanel = isMobile && tab !== "board";
  return (
    <>
      {isMobile && (
        <div className="vb-tabs" role="tablist" data-testid="variant-board-tabs">
          <button type="button" role="tab" aria-selected={tab === "variant"} className={tab === "variant" ? "is-active" : ""} onClick={() => setTab("variant")}>Вариант</button>
          <button type="button" role="tab" aria-selected={tab === "board"} className={tab === "board" ? "is-active" : ""} onClick={() => setTab("board")}>Доска</button>
          <button type="button" className="vb-tabs-close" aria-label="Скрыть доску" onClick={onCollapse}>✕</button>
        </div>
      )}
      <aside
        className={`vb-panel${isMobile ? " vb-panel--mobile" : ""}${hidePanel ? " vb-panel--hidden" : ""}`}
        style={isMobile ? undefined : { width: `${width}px` }}
        data-testid="variant-board-panel"
      >
        {!isMobile && (
          <div className="vb-divider" onPointerDown={onDragStart} role="separator" aria-orientation="vertical" title="Потяните, чтобы изменить ширину" />
        )}
        {!isMobile && (
          <div className="vb-panel-head">
            <button type="button" className="vb-close" onClick={onCollapse} aria-label="Скрыть доску" title="Скрыть доску">✕ Скрыть</button>
            <span className="vb-panel-title">{title}</span>
          </div>
        )}
        <div className="vb-board-body">
          <iframe
            key={split.boardId}
            className="vb-board-frame"
            title={title}
            src={variantBoardFrameSrc(split.boardId)}
            data-testid="variant-board-frame"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
          {dragging && <div className="vb-drag-shield" />}
        </div>
      </aside>
    </>
  );
}

